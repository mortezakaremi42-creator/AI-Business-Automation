# ALVARO FASHION — Technical & Functional Manifest (For AI & Developer Review)

## 1. Project Identity
- **Brand Name:** `ALVARO FASHION`
- **Project Type:** Complete Standalone Persian (`fa-IR`, `RTL`) Luxury Women's Fashion E-Commerce Storefront
- **Tech Stack:** Pure Semantic `HTML5` + Custom Responsive `CSS3` + Vanilla `JavaScript (ES5/ES6)` — Zero server or database required (`file://` and static-host compatible)
- **Color Palette:** Ivory White (`#FAF8F5` / `#FFFFFF`), Obsidian Black (`#0D0D0F`), Champagne Gold (`#C5A059` / `#E4C98E`)

## 2. Complete Directory & File Map
- `index.html` — Main single-entry storefront containing Header, Hero Banner («زیبایی در انتخاب استایل شما»), 8 Categories, Best Sellers, Full Searchable/Filterable/Sortable Storefront, New Arrivals, Special Offers, Brand Story, Contact Form, Full Footer, Dedicated Product Detail Page (`#productDetailView`), Slide-over Shopping Cart Drawer, Mobile Navigation Drawer, Size Guide Modal, and Demo Checkout Modal.
- `assets/css/style.css` — Luxury RTL design system, local `@font-face` Vazirmatn definitions, animations, and responsive breakpoints (`1024px`, `768px`, `480px`).
- `assets/js/products-data.js` — Structured catalog of **16 sample products** across all **8 required categories**:
  1. `مانتو زنانه` (`prod-01`, `prod-02`)
  2. `شومیز` (`prod-03`, `prod-04`)
  3. `لباس مجلسی` (`prod-05`, `prod-06`)
  4. `کت زنانه` (`prod-07`, `prod-08`)
  5. `کیف دستی` (`prod-09`, `prod-10`)
  6. `کفش زنانه` (`prod-11`, `prod-12`)
  7. `شلوار زنانه` (`prod-13`, `prod-14`)
  8. `ست لباس` (`prod-15`, `prod-16`)
- `assets/js/app.js` — Interactive application engine:
  - Live instant search (`#productSearchInput`)
  - Category filtering (cards, dropdown `#categorySelect`, and filter pills)
  - Price & collection sorting (`featured`, `price-asc`, `price-desc`, `newest`, `discount`)
  - Dedicated Product Detail View (`#product/<id>` hash routing + browser Back button support + size/color selection + quantity control + related items)
  - Active Shopping Cart (`+` increment, `−` decrement, single remove, clear all, `ALVARO10` 10% coupon, free VIP shipping >= 5,000,000 Toman, `localStorage` persistence under `alvaro_fashion_cart_v1`)
  - Wishlist with `localStorage` persistence (`alvaro_fashion_wishlist_v1`)
  - Demo Checkout flow generating a sample tracking code (explicitly labeled demo — no real payment gateway or fake personal data)
  - Validated Contact Us form (`#contactUsForm`) & VIP Newsletter form (`#newsletterForm`)
  - Responsive Mobile Drawer Menu (`#mobileMenuDrawer`)
- `assets/fonts/` — Local WOFF2 `Vazirmatn` font files (`400`, `500`, `700`, `800`) for fast offline/online rendering.
- `assets/images/` — Custom SVG logos (`logo-alvaro.svg`, `logo-alvaro-light.svg`, `favicon.svg`), `hero-banner.jpg`, `brand-atelier.jpg`, and 16 product photos in `assets/images/products/`.
- `manifest.webmanifest` & `.htaccess` & `README-FA.md` — Android Chrome web-app manifest, Apache/cPanel optimization rules, and Persian deployment guide.
