import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { lockSync } from "proper-lockfile";
import { z } from "zod";
import type { ExecutionJournal } from "./safeSpotExecution.js";
const stateSchema = z
  .object({
    halted: z.boolean(),
    cancelUncertain: z.array(z.string()).optional(),
    intents: z.array(
      z
        .object({
          id: z.string(),
          order: z
            .object({
              clientOrderId: z.string(),
              symbol: z.string(),
              side: z.enum(["BUY", "SELL"]),
              quantity: z.string(),
              type: z.enum(["LIMIT_IOC", "MARKET"]),
              limitPrice: z.string().optional(),
            })
            .strict(),
          status: z.enum([
            "UNKNOWN",
            "OPEN",
            "FILLED",
            "CANCELLED",
            "REJECTED",
          ]),
          orderId: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
const digest = (s: unknown) =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
/** One writer per isolated live journal; never reuse the paper ledger path. No credentials stored. */
export class FileExecutionJournal implements ExecutionJournal {
  private release: () => void;
  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.closeSync(fs.openSync(file + ".guard", "a", 0o600));
    this.release = lockSync(file + ".guard", {
      realpath: false,
      retries: 0,
      stale: 30000,
    });
  }
  load() {
    if (!fs.existsSync(this.file)) return { halted: true, intents: [] };
    try {
      const env = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (env.version !== 1 || env.checksum !== digest(env.state))
        throw Error();
      const s = stateSchema.parse(env.state);
      if (
        new Set(s.intents.map((i) => i.id)).size !== s.intents.length ||
        s.intents.some((i) => i.id !== i.order.clientOrderId)
      )
        throw Error();
      return s;
    } catch {
      throw Error("LIVE_JOURNAL_CORRUPT_DO_NOT_RESET");
    }
  }
  save(state: ReturnType<ExecutionJournal["load"]>) {
    stateSchema.parse(state);
    const temporary = this.file + "." + randomUUID() + ".tmp";
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(
        fd,
        JSON.stringify({ version: 1, state, checksum: digest(state) }),
      );
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.file);
      if (process.platform !== "win32") {
        const dir = fs.openSync(path.dirname(this.file), "r");
        try {
          fs.fsyncSync(dir);
        } finally {
          fs.closeSync(dir);
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  close() {
    this.release();
  }
}
