/**
 * ALVARO FASHION — منطق کامل تعاملی فروشگاه اینترنتی
 * پشتیبانی از جست‌وجوی آنی، فیلتر دسته‌بندی، مرتب‌سازی قیمت، صفحه جزئیات محصول،
 * سبد خرید فعال با ذخیره در مرورگر (localStorage)، علاقه‌مندی‌ها، منوی موبایل و فرم‌ها.
 */
(function () {
  'use strict';

  var STORAGE_CART_KEY = 'alvaro_fashion_cart_v1';
  var STORAGE_WISH_KEY = 'alvaro_fashion_wishlist_v1';

  var products = window.ALVARO_PRODUCTS || [];
  var categories = window.ALVARO_CATEGORIES || [];

  var state = {
    searchQuery: '',
    selectedCategory: 'all',
    sortBy: 'featured',
    onlyDiscounted: false,
    cart: loadStorage(STORAGE_CART_KEY, []),
    wishlist: loadStorage(STORAGE_WISH_KEY, []),
    couponCode: '',
    couponDiscountPercent: 0,
    activeDetailProductId: null,
    detailSelectedSize: '',
    detailSelectedColor: '',
    detailQty: 1,
  };

  function loadStorage(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveStorage(key, val) {
    try {
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      // ادامه اجرا در حالت مرورگر خصوصی
    }
  }

  function toPersianDigits(val) {
    var map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(val).replace(/\d/g, function (d) {
      return map[Number(d)];
    });
  }

  function formatToman(amount) {
    var formatted = Math.round(Number(amount) || 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    return toPersianDigits(formatted) + ' تومان';
  }

  function showToast(message) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = message;
    container.appendChild(item);
    setTimeout(function () {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 3400);
  }

  // ==================== رندر دسته‌بندی‌ها ====================
  function renderCategoriesSection() {
    var grid = document.getElementById('categoriesGrid');
    var pillsWrap = document.getElementById('categoryFilterPills');
    var catSelect = document.getElementById('categorySelect');
    if (!grid) return;

    var visualCats = categories.filter(function (c) {
      return c.id !== 'all';
    });

    grid.innerHTML = visualCats
      .map(function (cat) {
        var count = products.filter(function (p) {
          return p.category === cat.id;
        }).length;
        var isActive = state.selectedCategory === cat.id ? 'active' : '';
        return (
          '<button type="button" class="category-card ' +
          isActive +
          '" data-cat-pick="' +
          cat.id +
          '">' +
          '<img src="' +
          cat.coverImage +
          '" alt="' +
          cat.title +
          '" loading="lazy" />' +
          '<div class="category-overlay">' +
          '<strong>' +
          cat.title +
          '</strong>' +
          '<span>' +
          cat.subtitle +
          ' • ' +
          toPersianDigits(count) +
          ' مدل</span>' +
          '</div>' +
          '</button>'
        );
      })
      .join('');

    if (pillsWrap) {
      pillsWrap.innerHTML =
        categories
          .map(function (cat) {
            var activeCls =
              state.selectedCategory === cat.id && !state.onlyDiscounted
                ? 'active'
                : '';
            return (
              '<button type="button" class="filter-pill ' +
              activeCls +
              '" data-pill-cat="' +
              cat.id +
              '">' +
              cat.title +
              '</button>'
            );
          })
          .join('') +
        '<button type="button" class="filter-pill ' +
        (state.onlyDiscounted ? 'active' : '') +
        '" data-pill-discount="1">فقط تخفیف‌دارها</button>';
    }

    if (catSelect && catSelect.options.length <= 1) {
      catSelect.innerHTML = categories
        .map(function (c) {
          return '<option value="' + c.id + '">' + c.title + '</option>';
        })
        .join('');
    }
    if (catSelect) {
      catSelect.value = state.selectedCategory;
    }
  }

  // ==================== قالب کارت محصول ====================
  function createProductCardHtml(product) {
    var isWished = state.wishlist.indexOf(product.id) !== -1;
    var discountHtml =
      product.discountPercent > 0
        ? '<span class="discount-tag">' +
          toPersianDigits(product.discountPercent) +
          '٪ تخفیف</span>'
        : '';
    var badgeHtml = product.badge
      ? '<span class="product-badge">' + product.badge + '</span>'
      : '';
    var oldPriceHtml = product.oldPrice
      ? '<span class="price-old">' + formatToman(product.oldPrice) + '</span>'
      : '';

    return (
      '<article class="product-card" data-product-card="' +
      product.id +
      '">' +
      '<div class="product-media" data-open-product="' +
      product.id +
      '">' +
      badgeHtml +
      discountHtml +
      '<img src="' +
      product.image +
      '" alt="' +
      product.name +
      '" loading="lazy" />' +
      '<button type="button" class="wishlist-btn ' +
      (isWished ? 'active' : '') +
      '" data-toggle-wish="' +
      product.id +
      '" aria-label="افزودن به علاقه‌مندی‌ها" title="علاقه‌مندی">' +
      (isWished ? '♥' : '♡') +
      '</button>' +
      '</div>' +
      '<div class="product-body">' +
      '<span class="product-cat">' +
      product.categoryTitle +
      '</span>' +
      '<h3 class="product-title" data-open-product="' +
      product.id +
      '">' +
      product.name +
      '</h3>' +
      '<p class="product-desc">' +
      product.shortDesc +
      '</p>' +
      '<div class="product-price-row">' +
      '<span class="price-current">' +
      formatToman(product.price) +
      '</span>' +
      oldPriceHtml +
      '</div>' +
      '<div class="product-actions">' +
      '<button type="button" class="btn-card-view" data-open-product="' +
      product.id +
      '">مشاهده محصول</button>' +
      '<button type="button" class="btn-card-quickadd" data-quick-add="' +
      product.id +
      '" title="افزودن سریع به سبد خرید">+ سبد</button>' +
      '</div>' +
      '</div>' +
      '</article>'
    );
  }

  // ==================== فیلتر، جست‌وجو و مرتب‌سازی فروشگاه ====================
  function getFilteredAndSortedProducts() {
    var q = state.searchQuery.trim().toLowerCase();
    var list = products.filter(function (p) {
      if (state.selectedCategory !== 'all' && p.category !== state.selectedCategory) {
        return false;
      }
      if (state.onlyDiscounted && (!p.discountPercent || p.discountPercent <= 0)) {
        return false;
      }
      if (q) {
        var haystack = (
          p.name +
          ' ' +
          p.categoryTitle +
          ' ' +
          p.shortDesc +
          ' ' +
          p.fabric
        ).toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    });

    var sorted = list.slice();
    if (state.sortBy === 'price-asc') {
      sorted.sort(function (a, b) {
        return a.price - b.price;
      });
    } else if (state.sortBy === 'price-desc') {
      sorted.sort(function (a, b) {
        return b.price - a.price;
      });
    } else if (state.sortBy === 'newest') {
      sorted.sort(function (a, b) {
        return Number(b.isNewArrival) - Number(a.isNewArrival);
      });
    } else if (state.sortBy === 'discount') {
      sorted.sort(function (a, b) {
        return (b.discountPercent || 0) - (a.discountPercent || 0);
      });
    }
    return sorted;
  }

  function renderMainStoreGrid() {
    var grid = document.getElementById('shopProductsGrid');
    var countEl = document.getElementById('shopResultsCount');
    var clearBtn = document.getElementById('clearSearchBtn');
    var resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (!grid) return;

    var filtered = getFilteredAndSortedProducts();

    if (countEl) {
      countEl.textContent =
        'نمایش ' +
        toPersianDigits(filtered.length) +
        ' محصول از ' +
        toPersianDigits(products.length) +
        ' مدل کالکشن آلوارو';
    }

    if (clearBtn) {
      clearBtn.classList.toggle('hidden', state.searchQuery.length === 0);
    }

    var hasActiveFilter =
      state.selectedCategory !== 'all' ||
      state.onlyDiscounted ||
      state.searchQuery.trim() !== '' ||
      state.sortBy !== 'featured';
    if (resetFiltersBtn) {
      resetFiltersBtn.classList.toggle('hidden', !hasActiveFilter);
    }

    if (filtered.length === 0) {
      grid.innerHTML =
        '<div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background:#fff; border:1px solid #e5dfd3; border-radius:10px;">' +
        '<h3 style="margin:0 0 8px;">محصولی مطابق جست‌وجوی شما یافت نشد</h3>' +
        '<p style="color:#66625b; margin:0 0 18px;">پیشنهاد می‌کنیم عبارت دیگری را جست‌وجو کنید یا فیلترها را بازنشانی نمایید.</p>' +
        '<button type="button" class="btn btn-obsidian" id="emptyResetBtn">نمایش همه محصولات فروشگاه</button>' +
        '</div>';
      var emptyBtn = document.getElementById('emptyResetBtn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', resetAllFilters);
      }
      return;
    }

    grid.innerHTML = filtered.map(createProductCardHtml).join('');
  }

  function renderCuratedHomepageSections() {
    var bestGrid = document.getElementById('bestSellersGrid');
    var newGrid = document.getElementById('newArrivalsGrid');
    var offersGrid = document.getElementById('specialOffersGrid');

    if (bestGrid) {
      var bestItems = products
        .filter(function (p) {
          return p.isBestSeller;
        })
        .slice(0, 4);
      bestGrid.innerHTML = bestItems.map(createProductCardHtml).join('');
    }

    if (newGrid) {
      var newItems = products
        .filter(function (p) {
          return p.isNewArrival;
        })
        .slice(0, 4);
      newGrid.innerHTML = newItems.map(createProductCardHtml).join('');
    }

    if (offersGrid) {
      var offerItems = products
        .filter(function (p) {
          return p.isSpecialOffer;
        })
        .slice(0, 4);
      offersGrid.innerHTML = offerItems.map(createProductCardHtml).join('');
    }
  }

  function resetAllFilters() {
    state.searchQuery = '';
    state.selectedCategory = 'all';
    state.sortBy = 'featured';
    state.onlyDiscounted = false;
    var sInput = document.getElementById('productSearchInput');
    var sortSel = document.getElementById('sortSelect');
    if (sInput) sInput.value = '';
    if (sortSel) sortSel.value = 'featured';
    renderCategoriesSection();
    renderMainStoreGrid();
  }

  // ==================== صفحه مستقل جزئیات محصول ====================
  function openProductDetail(productId, pushHash) {
    var product = products.find(function (p) {
      return p.id === productId;
    });
    if (!product) return;

    state.activeDetailProductId = product.id;
    state.detailSelectedSize = product.sizes[0] || 'تک‌سایز';
    state.detailSelectedColor =
      (product.colors[0] && product.colors[0].name) || 'مشکی';
    state.detailQty = 1;

    var homeMain = document.getElementById('homeMainContent');
    var detailPage = document.getElementById('productDetailView');
    if (!homeMain || !detailPage) return;

    homeMain.classList.add('hidden');
    detailPage.classList.remove('hidden');

    if (pushHash !== false) {
      try {
        window.history.pushState(null, '', '#product/' + product.id);
      } catch (e) {}
    }

    renderProductDetailContent(product);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeProductDetailAndGoTo(sectionId) {
    var homeMain = document.getElementById('homeMainContent');
    var detailPage = document.getElementById('productDetailView');
    if (homeMain) homeMain.classList.remove('hidden');
    if (detailPage) detailPage.classList.add('hidden');
    state.activeDetailProductId = null;

    try {
      if (window.location.hash.indexOf('#product/') === 0) {
        window.history.pushState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }
    } catch (e) {}

    if (sectionId) {
      var target = document.getElementById(sectionId);
      if (target) {
        setTimeout(function () {
          target.scrollIntoView({ behavior: 'smooth' });
        }, 40);
      }
    }
  }

  function renderProductDetailContent(product) {
    var container = document.getElementById('productDetailContainer');
    if (!container) return;

    var related = products
      .filter(function (p) {
        return p.id !== product.id && p.category === product.category;
      })
      .concat(
        products.filter(function (p) {
          return p.id !== product.id && p.category !== product.category;
        })
      )
      .slice(0, 4);

    var oldPriceHtml = product.oldPrice
      ? '<span class="price-old" style="font-size:1rem;">' +
        formatToman(product.oldPrice) +
        '</span>'
      : '';
    var discountBadge =
      product.discountPercent > 0
        ? '<span class="discount-tag" style="position:static;">' +
          toPersianDigits(product.discountPercent) +
          '٪ تخفیف ویژه</span>'
        : '';

    var sizesHtml = product.sizes
      .map(function (sz) {
        var act = sz === state.detailSelectedSize ? 'active' : '';
        return (
          '<button type="button" class="size-chip ' +
          act +
          '" data-pick-size="' +
          sz +
          '">' +
          sz +
          '</button>'
        );
      })
      .join('');

    var colorsHtml = product.colors
      .map(function (clr) {
        var act = clr.name === state.detailSelectedColor ? 'active' : '';
        return (
          '<button type="button" class="color-chip ' +
          act +
          '" data-pick-color="' +
          clr.name +
          '">' +
          '<span class="color-dot" style="background:' +
          clr.hex +
          ';"></span>' +
          '<span>' +
          clr.name +
          '</span>' +
          '</button>'
        );
      })
      .join('');

    container.innerHTML =
      '<div class="breadcrumb-bar">' +
      '<div>' +
      '<button type="button" class="btn-card-view" id="backToShopBtn" style="border:none; padding:4px 0;">← بازگشت به فروشگاه</button>' +
      ' <span style="margin:0 8px;">|</span> ' +
      '<span>خانه / ' +
      product.categoryTitle +
      ' / <strong>' +
      product.name +
      '</strong></span>' +
      '</div>' +
      '<span class="detail-sku">کد استایل: ' +
      product.sku +
      '</span>' +
      '</div>' +
      '<div class="detail-grid">' +
      '<div class="detail-image-box">' +
      (product.badge
        ? '<span class="product-badge">' + product.badge + '</span>'
        : '') +
      '<img src="' +
      product.image +
      '" alt="' +
      product.name +
      '" />' +
      '</div>' +
      '<div>' +
      '<span class="section-eyebrow">' +
      product.categoryTitle +
      ' • ALVARO COUTURE</span>' +
      '<h1 class="detail-title">' +
      product.name +
      '</h1>' +
      '<div class="detail-price-box">' +
      '<span class="detail-price-main">' +
      formatToman(product.price) +
      '</span>' +
      oldPriceHtml +
      discountBadge +
      '</div>' +
      '<p style="color:#43403b; margin:0 0 22px; line-height:1.9;">' +
      product.fullDescription +
      '</p>' +
      '<div class="option-group">' +
      '<div class="option-label">' +
      '<span>انتخاب رنگ: <strong>' +
      state.detailSelectedColor +
      '</strong></span>' +
      '</div>' +
      '<div class="color-options">' +
      colorsHtml +
      '</div>' +
      '</div>' +
      '<div class="option-group">' +
      '<div class="option-label">' +
      '<span>انتخاب سایز: <strong>' +
      state.detailSelectedSize +
      '</strong></span>' +
      '<button type="button" id="openSizeGuideBtn" style="border:none; background:none; color:#987634; font-weight:700; cursor:pointer; text-decoration:underline;">جدول راهنمای سایز</button>' +
      '</div>' +
      '<div class="size-options">' +
      sizesHtml +
      '</div>' +
      '</div>' +
      '<div class="detail-purchase-row">' +
      '<div class="qty-control">' +
      '<button type="button" class="qty-btn" id="detailQtyPlus" aria-label="افزایش تعداد">+</button>' +
      '<span class="qty-val" id="detailQtyVal">' +
      toPersianDigits(state.detailQty) +
      '</span>' +
      '<button type="button" class="qty-btn" id="detailQtyMinus" aria-label="کاهش تعداد">−</button>' +
      '</div>' +
      '<button type="button" class="btn btn-gold" id="detailAddToCartBtn" style="flex:1;">افزودن به سبد خرید</button>' +
      '<button type="button" class="btn btn-outline-dark" id="detailWishBtn">' +
      (state.wishlist.indexOf(product.id) !== -1
        ? '♥ در علاقه‌مندی‌ها'
        : '♡ علاقه‌مندی') +
      '</button>' +
      '</div>' +
      '<div class="detail-specs">' +
      '<p><strong>جنس و متریال:</strong> ' +
      product.fabric +
      '</p>' +
      '<p><strong>نگهداری و شست‌وشو:</strong> ' +
      product.care +
      '</p>' +
      '<p><strong>بسته‌بندی و ارسال:</strong> ارسال در جعبه مشکی-طلایی اختصاصی ALVARO FASHION با ضمانت تعویض سایز تا ۷ روز</p>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div style="margin-top:54px;">' +
      '<div class="section-header"><div><span class="section-eyebrow">COMPLETE THE LOOK</span><h2 class="section-title">پیشنهاد استایلیست برای ست کردن</h2></div></div>' +
      '<div class="products-grid">' +
      related.map(createProductCardHtml).join('') +
      '</div>' +
      '</div>';

    // رویدادهای داخلی صفحه جزئیات
    var backBtn = document.getElementById('backToShopBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        closeProductDetailAndGoTo('shopSection');
      });
    }

    var sizeGuideBtn = document.getElementById('openSizeGuideBtn');
    if (sizeGuideBtn) {
      sizeGuideBtn.addEventListener('click', function () {
        openModal('sizeGuideModal');
      });
    }

    var plusBtn = document.getElementById('detailQtyPlus');
    var minusBtn = document.getElementById('detailQtyMinus');
    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        state.detailQty += 1;
        document.getElementById('detailQtyVal').textContent = toPersianDigits(
          state.detailQty
        );
      });
    }
    if (minusBtn) {
      minusBtn.addEventListener('click', function () {
        if (state.detailQty > 1) {
          state.detailQty -= 1;
          document.getElementById('detailQtyVal').textContent = toPersianDigits(
            state.detailQty
          );
        }
      });
    }

    var addBtn = document.getElementById('detailAddToCartBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        addToCart(
          product.id,
          state.detailSelectedSize,
          state.detailSelectedColor,
          state.detailQty
        );
        openCartDrawer();
      });
    }

    var wishBtn = document.getElementById('detailWishBtn');
    if (wishBtn) {
      wishBtn.addEventListener('click', function () {
        toggleWishlist(product.id);
        renderProductDetailContent(product);
      });
    }
  }

  // ==================== سبد خرید فعال با ذخیره در مرورگر ====================
  function makeCartKey(productId, size, color) {
    return productId + '__' + size + '__' + color;
  }

  function addToCart(productId, size, color, qty) {
    var product = products.find(function (p) {
      return p.id === productId;
    });
    if (!product) return;

    var chosenSize = size || product.sizes[0] || 'تک‌سایز';
    var chosenColor =
      color || (product.colors[0] && product.colors[0].name) || 'مشکی';
    var addQty = Math.max(1, Number(qty) || 1);
    var cartKey = makeCartKey(product.id, chosenSize, chosenColor);

    var existing = state.cart.find(function (item) {
      return item.cartKey === cartKey;
    });

    if (existing) {
      existing.qty += addQty;
    } else {
      state.cart.push({
        cartKey: cartKey,
        productId: product.id,
        name: product.name,
        price: product.price,
        image: product.image,
        size: chosenSize,
        color: chosenColor,
        qty: addQty,
      });
    }

    saveStorage(STORAGE_CART_KEY, state.cart);
    renderCartUI();
    showToast('«' + product.name + '» به سبد خرید اضافه شد.');
  }

  function updateCartItemQty(cartKey, delta) {
    for (var i = 0; i < state.cart.length; i++) {
      if (state.cart[i].cartKey === cartKey) {
        state.cart[i].qty += delta;
        if (state.cart[i].qty <= 0) {
          state.cart.splice(i, 1);
          showToast('محصول از سبد خرید حذف شد.');
        }
        break;
      }
    }
    saveStorage(STORAGE_CART_KEY, state.cart);
    renderCartUI();
  }

  function removeCartItem(cartKey) {
    state.cart = state.cart.filter(function (item) {
      return item.cartKey !== cartKey;
    });
    saveStorage(STORAGE_CART_KEY, state.cart);
    renderCartUI();
    showToast('آیتم انتخاب‌شده از سبد خرید حذف شد.');
  }

  function clearEntireCart() {
    state.cart = [];
    state.couponCode = '';
    state.couponDiscountPercent = 0;
    saveStorage(STORAGE_CART_KEY, state.cart);
    renderCartUI();
    showToast('سبد خرید خالی شد.');
  }

  function calculateCartTotals() {
    var subtotal = state.cart.reduce(function (sum, item) {
      return sum + item.price * item.qty;
    }, 0);
    var totalCount = state.cart.reduce(function (sum, item) {
      return sum + item.qty;
    }, 0);
    var couponDiscount = Math.round(
      (subtotal * state.couponDiscountPercent) / 100
    );
    var afterDiscount = Math.max(0, subtotal - couponDiscount);
    var shipping =
      afterDiscount === 0 || afterDiscount >= 5000000 ? 0 : 120000;
    var payable = afterDiscount + shipping;

    return {
      totalCount: totalCount,
      subtotal: subtotal,
      couponDiscount: couponDiscount,
      shipping: shipping,
      payable: payable,
    };
  }

  function renderCartUI() {
    var totals = calculateCartTotals();
    var countBadge = document.getElementById('cartCountBadge');
    var wishBadge = document.getElementById('wishCountBadge');
    var bodyEl = document.getElementById('cartItemsContainer');
    var footerEl = document.getElementById('cartDrawerFooter');

    if (countBadge) {
      countBadge.textContent = toPersianDigits(totals.totalCount);
    }
    if (wishBadge) {
      wishBadge.textContent = toPersianDigits(state.wishlist.length);
    }

    if (!bodyEl || !footerEl) return;

    if (state.cart.length === 0) {
      bodyEl.innerHTML =
        '<div style="text-align:center; padding:56px 12px; color:#66625b;">' +
        '<div style="font-size:2.4rem; margin-bottom:10px;">🛍️</div>' +
        '<strong style="display:block; color:#0d0d0f; margin-bottom:6px;">سبد خرید شما خالی است</strong>' +
        '<p style="font-size:0.85rem; margin:0 0 20px;">از کالکشن مانتو، لباس مجلسی، کیف و کفش آلوارو دیدن فرمایید.</p>' +
        '<button type="button" class="btn btn-obsidian" id="emptyCartGoShopBtn">مشاهده محصولات فروشگاه</button>' +
        '</div>';
      footerEl.classList.add('hidden');

      var goShop = document.getElementById('emptyCartGoShopBtn');
      if (goShop) {
        goShop.addEventListener('click', function () {
          closeAllDrawers();
          closeProductDetailAndGoTo('shopSection');
        });
      }
      return;
    }

    footerEl.classList.remove('hidden');

    bodyEl.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">' +
      '<span style="font-size:0.82rem; color:#66625b;">' +
      toPersianDigits(totals.totalCount) +
      ' کالا در سبد شما</span>' +
      '<button type="button" class="cart-remove-btn" id="clearCartBtn">حذف همه</button>' +
      '</div>' +
      state.cart
        .map(function (item) {
          return (
            '<div class="cart-item">' +
            '<img src="' +
            item.image +
            '" alt="' +
            item.name +
            '" />' +
            '<div>' +
            '<h4 class="cart-item-title">' +
            item.name +
            '</h4>' +
            '<div class="cart-item-meta">سایز: ' +
            item.size +
            ' | رنگ: ' +
            item.color +
            '</div>' +
            '<div style="font-weight:800; font-size:0.88rem; margin-bottom:8px;">' +
            formatToman(item.price * item.qty) +
            '</div>' +
            '<div class="cart-item-controls">' +
            '<div class="cart-qty-mini">' +
            '<button type="button" data-cart-inc="' +
            item.cartKey +
            '" aria-label="افزایش">+</button>' +
            '<span>' +
            toPersianDigits(item.qty) +
            '</span>' +
            '<button type="button" data-cart-dec="' +
            item.cartKey +
            '" aria-label="کاهش">−</button>' +
            '</div>' +
            '<button type="button" class="cart-remove-btn" data-cart-rm="' +
            item.cartKey +
            '">حذف</button>' +
            '</div>' +
            '</div>' +
            '</div>'
          );
        })
        .join('');

    document.getElementById('cartSubtotalText').textContent = formatToman(
      totals.subtotal
    );
    document.getElementById('cartDiscountText').textContent =
      totals.couponDiscount > 0
        ? '− ' + formatToman(totals.couponDiscount)
        : '۰ تومان';
    document.getElementById('cartShippingText').textContent =
      totals.shipping === 0
        ? 'رایگان (VIP)'
        : formatToman(totals.shipping);
    document.getElementById('cartTotalPayableText').textContent = formatToman(
      totals.payable
    );

    var clearBtn = document.getElementById('clearCartBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearEntireCart);
    }
  }

  // ==================== علاقه‌مندی‌ها ====================
  function toggleWishlist(productId) {
    var idx = state.wishlist.indexOf(productId);
    if (idx === -1) {
      state.wishlist.push(productId);
      showToast('به لیست علاقه‌مندی‌های شما اضافه شد.');
    } else {
      state.wishlist.splice(idx, 1);
      showToast('از لیست علاقه‌مندی‌ها خارج شد.');
    }
    saveStorage(STORAGE_WISH_KEY, state.wishlist);
    renderMainStoreGrid();
    renderCuratedHomepageSections();
    renderCartUI();
  }

  // ==================== کنترل کشوها و مودال‌ها ====================
  function openCartDrawer() {
    document.getElementById('globalBackdrop').classList.add('open');
    document.getElementById('cartDrawer').classList.add('open');
    document.getElementById('mobileMenuDrawer').classList.remove('open');
  }

  function openMobileMenu() {
    document.getElementById('globalBackdrop').classList.add('open');
    document.getElementById('mobileMenuDrawer').classList.add('open');
    document.getElementById('cartDrawer').classList.remove('open');
  }

  function closeAllDrawers() {
    document.getElementById('globalBackdrop').classList.remove('open');
    document.getElementById('cartDrawer').classList.remove('open');
    document.getElementById('mobileMenuDrawer').classList.remove('open');
  }

  function openModal(modalId) {
    var el = document.getElementById(modalId);
    if (el) el.classList.add('open');
  }

  function closeModal(modalId) {
    var el = document.getElementById(modalId);
    if (el) el.classList.remove('open');
  }

  // ==================== راه‌اندازی رویدادهای صفحه ====================
  function bindGlobalEvents() {
    // افکت اسکرول هدر
    window.addEventListener('scroll', function () {
      var header = document.getElementById('siteHeader');
      if (header) {
        header.classList.toggle('scrolled', window.scrollY > 30);
      }
    });

    // مدیریت رویدادهای کلیک عمومی (Delegation)
    document.addEventListener('click', function (e) {
      var target = e.target;

      // باز کردن جزئیات محصول
      var openProdTrigger = target.closest('[data-open-product]');
      if (openProdTrigger) {
        e.preventDefault();
        openProductDetail(openProdTrigger.getAttribute('data-open-product'));
        return;
      }

      // افزودن سریع به سبد
      var quickAddBtn = target.closest('[data-quick-add]');
      if (quickAddBtn) {
        e.preventDefault();
        addToCart(quickAddBtn.getAttribute('data-quick-add'), null, null, 1);
        return;
      }

      // علاقه‌مندی
      var wishTrigger = target.closest('[data-toggle-wish]');
      if (wishTrigger) {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist(wishTrigger.getAttribute('data-toggle-wish'));
        return;
      }

      // انتخاب کارت دسته‌بندی
      var catCard = target.closest('[data-cat-pick]');
      if (catCard) {
        state.selectedCategory = catCard.getAttribute('data-cat-pick');
        state.onlyDiscounted = false;
        renderCategoriesSection();
        renderMainStoreGrid();
        closeProductDetailAndGoTo('shopSection');
        return;
      }

      // فیلتر قرصی دسته‌بندی
      var pillCat = target.closest('[data-pill-cat]');
      if (pillCat) {
        state.selectedCategory = pillCat.getAttribute('data-pill-cat');
        state.onlyDiscounted = false;
        renderCategoriesSection();
        renderMainStoreGrid();
        return;
      }

      // فیلتر قرصی تخفیف‌دار
      var pillDisc = target.closest('[data-pill-discount]');
      if (pillDisc) {
        state.onlyDiscounted = !state.onlyDiscounted;
        renderCategoriesSection();
        renderMainStoreGrid();
        return;
      }

      // انتخاب سایز در صفحه جزئیات
      var sizeChip = target.closest('[data-pick-size]');
      if (sizeChip && state.activeDetailProductId) {
        state.detailSelectedSize = sizeChip.getAttribute('data-pick-size');
        var prod1 = products.find(function (p) {
          return p.id === state.activeDetailProductId;
        });
        if (prod1) renderProductDetailContent(prod1);
        return;
      }

      // انتخاب رنگ در صفحه جزئیات
      var colorChip = target.closest('[data-pick-color]');
      if (colorChip && state.activeDetailProductId) {
        state.detailSelectedColor = colorChip.getAttribute('data-pick-color');
        var prod2 = products.find(function (p) {
          return p.id === state.activeDetailProductId;
        });
        if (prod2) renderProductDetailContent(prod2);
        return;
      }

      // کنترل‌های داخل سبد خرید (+ / - / حذف)
      var incBtn = target.closest('[data-cart-inc]');
      if (incBtn) {
        updateCartItemQty(incBtn.getAttribute('data-cart-inc'), 1);
        return;
      }
      var decBtn = target.closest('[data-cart-dec]');
      if (decBtn) {
        updateCartItemQty(decBtn.getAttribute('data-cart-dec'), -1);
        return;
      }
      var rmBtn = target.closest('[data-cart-rm]');
      if (rmBtn) {
        removeCartItem(rmBtn.getAttribute('data-cart-rm'));
        return;
      }

      // لینک‌های ناوبری (خانه، فروشگاه، محصولات جدید، تخفیف‌ها، تماس با ما)
      var navScroll = target.closest('[data-nav-target]');
      if (navScroll) {
        e.preventDefault();
        var dest = navScroll.getAttribute('data-nav-target');
        var filterCat = navScroll.getAttribute('data-nav-cat');
        if (filterCat) {
          state.selectedCategory = filterCat;
          state.onlyDiscounted = false;
          renderCategoriesSection();
          renderMainStoreGrid();
        }
        closeAllDrawers();
        closeProductDetailAndGoTo(dest);
      }
    });

    // جست‌وجوی آنی محصولات
    var searchInput = document.getElementById('productSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        state.searchQuery = e.target.value;
        renderMainStoreGrid();
      });
    }

    var clearSearchBtn = document.getElementById('clearSearchBtn');
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', function () {
        state.searchQuery = '';
        if (searchInput) searchInput.value = '';
        renderMainStoreGrid();
      });
    }

    // دکمه جست‌وجوی سریع هدر
    var headerSearchBtn = document.getElementById('headerSearchBtn');
    if (headerSearchBtn) {
      headerSearchBtn.addEventListener('click', function () {
        closeProductDetailAndGoTo('shopSection');
        setTimeout(function () {
          if (searchInput) searchInput.focus();
        }, 350);
      });
    }

    // دکمه نمایش علاقه‌مندی‌ها در هدر
    var headerWishBtn = document.getElementById('headerWishlistBtn');
    if (headerWishBtn) {
      headerWishBtn.addEventListener('click', function () {
        if (state.wishlist.length === 0) {
          showToast('لیست علاقه‌مندی‌های شما خالی است؛ روی آیکون قلب محصولات کلیک کنید.');
          return;
        }
        var firstWish = state.wishlist[state.wishlist.length - 1];
        openProductDetail(firstWish);
      });
    }

    // انتخاب دسته‌بندی و مرتب‌سازی از منوی کشویی
    var catSelect = document.getElementById('categorySelect');
    if (catSelect) {
      catSelect.addEventListener('change', function (e) {
        state.selectedCategory = e.target.value;
        state.onlyDiscounted = false;
        renderCategoriesSection();
        renderMainStoreGrid();
      });
    }

    var sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
      sortSelect.addEventListener('change', function (e) {
        state.sortBy = e.target.value;
        renderMainStoreGrid();
      });
    }

    var resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener('click', resetAllFilters);
    }

    // باز و بسته کردن سبد خرید و منوی موبایل
    document
      .getElementById('openCartBtn')
      .addEventListener('click', openCartDrawer);
    document
      .getElementById('closeCartBtn')
      .addEventListener('click', closeAllDrawers);
    document
      .getElementById('openMobileMenuBtn')
      .addEventListener('click', openMobileMenu);
    document
      .getElementById('closeMobileMenuBtn')
      .addEventListener('click', closeAllDrawers);
    document
      .getElementById('globalBackdrop')
      .addEventListener('click', closeAllDrawers);

    // کپی کد تخفیف ALVARO10
    var copyCouponBtn = document.getElementById('copyPromoCouponBtn');
    if (copyCouponBtn) {
      copyCouponBtn.addEventListener('click', function () {
        state.couponCode = 'ALVARO10';
        state.couponDiscountPercent = 10;
        var couponInput = document.getElementById('cartCouponInput');
        if (couponInput) couponInput.value = 'ALVARO10';
        renderCartUI();
        showToast('کد تخفیف ۱۰٪ (ALVARO10) روی سبد خرید شما فعال شد!');
      });
    }

    // اعمال کد تخفیف در سبد خرید
    var applyCouponBtn = document.getElementById('applyCouponBtn');
    if (applyCouponBtn) {
      applyCouponBtn.addEventListener('click', function () {
        var input = document.getElementById('cartCouponInput');
        var code = ((input && input.value) || '').trim().toUpperCase();
        if (code === 'ALVARO10') {
          state.couponCode = code;
          state.couponDiscountPercent = 10;
          renderCartUI();
          showToast('کد تخفیف ۱۰٪ آلوارو با موفقیت اعمال شد.');
        } else {
          state.couponCode = '';
          state.couponDiscountPercent = 0;
          renderCartUI();
          showToast('کد واردشده معتبر نیست (کد آزمایشی: ALVARO10).');
        }
      });
    }

    // ثبت سفارش آزمایشی (بدون درگاه واقعی)
    var checkoutBtn = document.getElementById('proceedDemoCheckoutBtn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', function () {
        closeAllDrawers();
        var totals = calculateCartTotals();
        document.getElementById('checkoutModalPayable').textContent =
          formatToman(totals.payable);
        document.getElementById('demoCheckoutFormWrap').classList.remove('hidden');
        document.getElementById('demoCheckoutSuccessWrap').classList.add('hidden');
        openModal('demoCheckoutModal');
      });
    }

    var demoCheckoutForm = document.getElementById('demoCheckoutForm');
    if (demoCheckoutForm) {
      demoCheckoutForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var customerName = document.getElementById('chkName').value.trim();
        var tracking =
          'ALV-' + toPersianDigits(Math.floor(100000 + Math.random() * 900000));
        document.getElementById('demoTrackingCode').textContent = tracking;
        document.getElementById('demoCustomerGreeting').textContent =
          customerName || 'مشتری گرامی';
        document.getElementById('demoCheckoutFormWrap').classList.add('hidden');
        document
          .getElementById('demoCheckoutSuccessWrap')
          .classList.remove('hidden');

        // خالی کردن سبد خرید پس از ثبت آزمایشی
        state.cart = [];
        state.couponDiscountPercent = 0;
        saveStorage(STORAGE_CART_KEY, state.cart);
        renderCartUI();
      });
    }

    // بستن مودال‌ها
    var closeCheckoutModalBtn = document.getElementById('closeCheckoutModalBtn');
    if (closeCheckoutModalBtn) {
      closeCheckoutModalBtn.addEventListener('click', function () {
        closeModal('demoCheckoutModal');
      });
    }
    var closeSizeModalBtn = document.getElementById('closeSizeGuideModalBtn');
    if (closeSizeModalBtn) {
      closeSizeModalBtn.addEventListener('click', function () {
        closeModal('sizeGuideModal');
      });
    }

    // فرم تماس با ما
    var contactForm = document.getElementById('contactUsForm');
    if (contactForm) {
      contactForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var fullName = document.getElementById('contactName').value.trim();
        var msgBox = document.getElementById('contactSuccessNotice');
        if (msgBox) {
          msgBox.textContent =
            'پیام آزمایشی شما با نام «' +
            fullName +
            '» با موفقیت ثبت شد. در نسخه عملیاتی مشتری، این فرم مستقیماً به پنل مدیریت و پیامک متصل می‌گردد.';
          msgBox.classList.remove('hidden');
        }
        contactForm.reset();
        showToast('پیام شما با موفقیت ثبت گردید.');
      });
    }

    // فرم خبرنامه فوتر
    var newsletterForm = document.getElementById('newsletterForm');
    if (newsletterForm) {
      newsletterForm.addEventListener('submit', function (e) {
        e.preventDefault();
        newsletterForm.reset();
        showToast('عضویت آزمایشی شما در باشگاه مشتریان VIP آلوارو ثبت شد.');
      });
    }

    // کلید ESC برای بستن کشوها و مودال‌ها
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllDrawers();
        closeModal('demoCheckoutModal');
        closeModal('sizeGuideModal');
      }
    });

    // پشتیبانی از دکمه بازگشت مرورگر موبایل در صفحه محصول
    window.addEventListener('popstate', function () {
      var hash = window.location.hash || '';
      if (hash.indexOf('#product/') === 0) {
        var pid = hash.replace('#product/', '');
        openProductDetail(pid, false);
      } else if (state.activeDetailProductId) {
        closeProductDetailAndGoTo();
      }
    });
  }

  // ==================== مقداردهی اولیه ====================
  function initApp() {
    renderCategoriesSection();
    renderCuratedHomepageSections();
    renderMainStoreGrid();
    renderCartUI();
    bindGlobalEvents();

    // بررسی Hash اولیه در صورت اشتراک‌گذاری لینک مستقیم یک محصول
    if (window.location.hash && window.location.hash.indexOf('#product/') === 0) {
      var initialPid = window.location.hash.replace('#product/', '');
      openProductDetail(initialPid, false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
