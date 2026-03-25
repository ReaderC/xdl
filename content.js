// X/Twitter 原图下载器 - 内容脚本
(function () {
  'use strict';

  function getDefaultBatchSettings() {
    return {
      types: { image: true, video: true, gif: true },
      quality: '4096x4096',
      dateRange: { start: '', end: '' },
      pathTemplate: 'X_Downloads/{user}',
      nameTemplate: '{date}_{id}'
    };
  }

  function cloneBatchSettings(settings = getDefaultBatchSettings()) {
    return {
      types: {
        image: settings.types?.image !== false,
        video: settings.types?.video !== false,
        gif: settings.types?.gif !== false
      },
      quality: settings.quality || '4096x4096',
      dateRange: {
        start: settings.dateRange?.start || '',
        end: settings.dateRange?.end || ''
      },
      pathTemplate: settings.pathTemplate || 'X_Downloads/{user}',
      nameTemplate: settings.nameTemplate || '{date}_{id}'
    };
  }

  function sanitizeBatchTemplateValue(value, fallbackValue) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallbackValue;
  }

  function normalizeBatchSettings(rawSettings, fallbackQuality = '4096x4096') {
    const defaults = getDefaultBatchSettings();
    const raw = rawSettings || {};

    return {
      types: {
        image: raw.types?.image !== false,
        video: raw.types?.video !== false,
        gif: raw.types?.gif !== false
      },
      quality: sanitizeBatchTemplateValue(raw.quality, fallbackQuality || defaults.quality),
      dateRange: {
        start: typeof raw.dateRange?.start === 'string' ? raw.dateRange.start : defaults.dateRange.start,
        end: typeof raw.dateRange?.end === 'string' ? raw.dateRange.end : defaults.dateRange.end
      },
      pathTemplate: sanitizeBatchTemplateValue(raw.pathTemplate, defaults.pathTemplate),
      nameTemplate: sanitizeBatchTemplateValue(raw.nameTemplate, defaults.nameTemplate)
    };
  }

  // 默认设置
  let userSettings = {
    imageQuality: '4096x4096',
    enablePreview: true,
    enableImagePreview: true,
    enableGifPreview: true,
    previewShortcut: 'none',
    previewDelay: 300,
    previewTriggerMode: 'auto',  // 'auto' = 自动显示, 'key' = 按键触发
    previewTriggerKey: 'shift',  // shift, alt, ctrl
    previewFollowMouse: true,    // 预览窗口始终跟随鼠标移动
    batchSettings: getDefaultBatchSettings()
  };

  function persistBatchSettings(settings, callback) {
    const normalized = normalizeBatchSettings(settings, userSettings.imageQuality);
    chrome.storage.sync.set({ batchSettings: normalized }, () => {
      userSettings.batchSettings = normalized;
      if (typeof BatchDownloader !== 'undefined') {
        BatchDownloader.config = cloneBatchSettings(normalized);
      }
      callback?.(normalized);
    });
  }

  // 加载用户设置
  function loadSettings() {
    chrome.storage.sync.get({
      imageQuality: '4096x4096',
      enablePreview: true,
      enableImagePreview: true,
      enableGifPreview: true,
      previewShortcut: 'none',
      previewDelay: 300,
      previewTriggerMode: 'auto',
      previewTriggerKey: 'shift',
      previewFollowMouse: true,
      batchSettings: getDefaultBatchSettings()
    }, (items) => {
      const batchSettings = normalizeBatchSettings(items.batchSettings, items.imageQuality);
      userSettings = { ...items, batchSettings };
      userSettings.previewFollowMouse = true; // 始终强制跟随鼠标
      CONFIG.PREVIEW_DELAY = userSettings.previewDelay;

      if (typeof BatchDownloader !== 'undefined') {
        BatchDownloader.config = cloneBatchSettings(batchSettings);
      }
    });
  }

  // 监听设置更新消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated') {
      const batchSettings = normalizeBatchSettings(message.settings?.batchSettings, message.settings?.imageQuality || userSettings.imageQuality);
      userSettings = { ...userSettings, ...message.settings, batchSettings };
      userSettings.previewFollowMouse = true; // 始终强制跟随鼠标
      CONFIG.PREVIEW_DELAY = userSettings.previewDelay;
      if (typeof BatchDownloader !== 'undefined') {
        BatchDownloader.config = cloneBatchSettings(batchSettings);
      }
    }
    // 处理批量下载消息
    if (message.action === 'batchDownload') {
      handleBatchDownload(message.filters);
    }
  });

  const CONFIG = {
    QUALITY_OPTIONS: [
      { name: '4096x4096', label: '4096x4096', desc: '超高清' },
      { name: 'large', label: 'Large', desc: '大图 (1024px)' },
      { name: 'medium', label: 'Medium', desc: '中等 (600px)' },
      { name: 'small', label: 'Small', desc: '小图 (340px)' }
    ],
    PREVIEW_QUALITY: 'medium',
    IMAGE_DOMAINS: ['pbs.twimg.com'],
    BUTTON_CLASS: 'x-original-download-btn',
    VIDEO_BUTTON_CLASS: 'x-video-download-btn',
    GIF_BUTTON_CLASS: 'x-gif-download-btn',
    PREVIEW_CLASS: 'x-image-preview',
    PREVIEW_DELAY: 300,
    IMAGE_PROCESSED_ATTR: 'data-x-image-processed',
    VIDEO_PROCESSED_ATTR: 'data-x-video-processed'
  };

  // 辅助函数：读取用户设置
  function getEnablePreview() { return userSettings.enablePreview; }
  function getEnableImagePreview() { return userSettings.enableImagePreview !== false; }
  function getEnableGifPreview() { return userSettings.enableGifPreview !== false; }
  function getImageQuality() { return userSettings.imageQuality; }
  function getPreviewFollowMouse() { return true; } // 始终跟随鼠标

  // 检查是否满足预览触发条件（按键模式）
  function checkTriggerCondition(event) {
    if (userSettings.previewTriggerMode !== 'key') return true;

    const key = userSettings.previewTriggerKey;
    if (key === 'shift') return event.shiftKey;
    if (key === 'alt') return event.altKey;
    if (key === 'ctrl') return event.ctrlKey;
    return true;
  }

  function isHoveringPreviewExcludedControl(container, event) {
    const suppressedSelector = [
      `.${CONFIG.BUTTON_CLASS}`,
      `.${CONFIG.VIDEO_BUTTON_CLASS}`,
      `.${CONFIG.GIF_BUTTON_CLASS}`,
      '.x-quality-menu',
      '.x-quality-item',
      '.x-preview-quality-menu',
      '.x-preview-quality-item'
    ].join(', ');

    const hoverSelector = [
      `.${CONFIG.BUTTON_CLASS}:hover`,
      `.${CONFIG.VIDEO_BUTTON_CLASS}:hover`,
      `.${CONFIG.GIF_BUTTON_CLASS}:hover`,
      '.x-quality-menu:hover',
      '.x-preview-quality-menu:hover'
    ].join(', ');

    const elementUnderPointer = event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? document.elementFromPoint(event.clientX, event.clientY)
      : null;

    if (elementUnderPointer?.closest?.(suppressedSelector)) {
      return true;
    }

    if (container?.querySelector?.(hoverSelector)) {
      return true;
    }

    return !!document.querySelector(hoverSelector);
  }

  // 预览相关状态
  let previewElement = null;
  let previewTimeout = null;
  let currentPreviewUrl = null;
  let currentPreviewImg = null;
  let currentPreviewGif = null;
  let previewLoadToken = 0;
  let previewScale = 1;
  let isPreviewVisible = false;
  let basePreviewWidth = 0;
  let basePreviewHeight = 0;
  let previewHideTimer = null;
  let activePreviewTarget = null; // 当前预览目标元素
  let previewFollowMouseHandler = null; // 跟随鼠标移动的事件处理器
  let isTransitioningToPreview = false; // 是否正在从媒体过渡到预览窗口
  let isPreviewPinned = false; // 预览窗口是否已固定（跟随模式下按空格固定）
  let isInImageViewer = false;
  let currentImageList = [];
  let currentImageIndex = 0;
  let previewFollowSide = 'right';

  // 拖动相关
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let previewStartX = 0;
  let previewStartY = 0;

  /**
   * 获取图片 URL
   */
  function getImageUrl(url, quality) {
    try {
      const urlObj = new URL(url);
      if (!CONFIG.IMAGE_DOMAINS.includes(urlObj.hostname)) return null;
      urlObj.searchParams.set('name', quality);
      if (quality === '4096x4096') {
        urlObj.searchParams.set('format', 'png');
      }
      return urlObj.toString();
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取预览 URL
   */
  function getPreviewUrl(url) {
    try {
      const urlObj = new URL(url);
      if (!CONFIG.IMAGE_DOMAINS.includes(urlObj.hostname)) return null;
      urlObj.searchParams.set('name', CONFIG.PREVIEW_QUALITY);
      return urlObj.toString();
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取文件名
   */
  function getFileName(url, quality) {
    try {
      const urlObj = new URL(url);
      const parts = urlObj.pathname.split('/').filter(p => p);
      const mediaId = parts[parts.length - 1] || 'image';
      const ext = (quality === '4096x4096') ? 'png' : 'jpg';
      return `${mediaId}_${quality}.${ext}`;
    } catch (e) {
      return `x_image_${quality}.jpg`;
    }
  }

  /**
   * 提取推文 ID
   */
  function extractTweetId(element) {
    const urlMatch = window.location.href.match(/\/status\/(\d+)/);
    if (urlMatch) return urlMatch[1];

    if (element) {
      if (element.href && element.href.includes('/status/')) {
        const match = element.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }

    const article = element?.closest('article') || document.querySelector('article');
    if (article) {
      const tweetLink = article.querySelector('a[href*="/status/"]');
      if (tweetLink) {
        const match = tweetLink.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }

      const links = article.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const match = link.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }

    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
    for (const tweet of tweetElements) {
      const links = tweet.querySelectorAll('a[href*="/status/"]');
      for (const link of links) {
        const match = link.href.match(/\/status\/(\d+)/);
        if (match) return match[1];
      }
    }

    return null;
  }

  function sanitizePathSegment(value, fallback = 'unknown') {
    const sanitized = String(value || '')
      .replace(/[<>:"\\|?*\x00-\x1F]/g, '_')
      .replace(/[. ]+$/g, '')
      .trim();
    return sanitized || fallback;
  }

  function sanitizeRelativePath(path, fallback = 'X_Downloads/unknown') {
    const normalized = String(path || '')
      .replace(/\\+/g, '/')
      .replace(/^\/+|\/+$/g, '');

    const segments = normalized
      .split('/')
      .map((segment) => sanitizePathSegment(segment, 'unknown'))
      .filter(Boolean);

    return segments.length ? segments.join('/') : fallback;
  }

  function replaceTemplateTokens(template, tokens) {
    return String(template || '').replace(/\{(date|time|id|user)\}/g, (_, token) => tokens[token] || 'unknown');
  }

  function getItemUserName(element) {
    const article = element?.closest?.('article') || element;
    const links = article?.querySelectorAll?.('a[href*="/status/"]') || [];

    for (const link of links) {
      const match = link.getAttribute('href')?.match(/^\/([^/]+)\/status\/\d+/);
      if (match?.[1]) return sanitizePathSegment(match[1]);
    }

    const pathMatch = window.location.pathname.match(/^\/([^/]+)/);
    if (pathMatch?.[1] && !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(pathMatch[1])) {
      return sanitizePathSegment(pathMatch[1]);
    }

    return 'unknown';
  }

  function matchesBatchDateRange(item, dateRange) {
    if (!item?.date || !(item.date instanceof Date) || Number.isNaN(item.date.getTime())) {
      return true;
    }

    if (dateRange?.start) {
      const startDate = new Date(dateRange.start);
      if (!Number.isNaN(startDate.getTime()) && item.date < startDate) {
        return false;
      }
    }

    if (dateRange?.end) {
      const endDate = new Date(dateRange.end);
      if (!Number.isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        if (item.date > endDate) {
          return false;
        }
      }
    }

    return true;
  }

  function resolveBatchDownloadTarget(item, config, fallbackUserName = 'unknown') {
    const date = item?.date instanceof Date && !Number.isNaN(item.date.getTime()) ? item.date : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const timeStr = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
    const user = sanitizePathSegment(item?.userName || fallbackUserName || 'unknown');
    const id = sanitizePathSegment(item?.tweetId || item?.id || 'unknown');
    const tokens = { date: dateStr, time: timeStr, id, user };

    const folder = sanitizeRelativePath(replaceTemplateTokens(config.pathTemplate, tokens), `X_Downloads/${user}`);
    const baseName = sanitizePathSegment(replaceTemplateTokens(config.nameTemplate, tokens), `${dateStr}_${id}`);
    const extension = item.type === 'image'
      ? (item.url?.includes('format=png') ? 'png' : 'jpg')
      : 'mp4';

    return {
      folder,
      filename: `${baseName}.${extension}`,
      baseName,
      extension,
      user
    };
  }

  /**
   * 获取当前推文中的所有图片
   * @param {Element} element 起始元素
   * @returns {Array} 图片 URL 数组
   */
  function getTweetImages(element) {
    const images = [];

    // 找到包含图片的容器（推文）
    const article = element?.closest('article') || document.querySelector('article');
    if (!article) return images;

    // 收集当前推文中的所有图片
    const imgElements = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    imgElements.forEach(img => {
      const url = img.src;
      if (url && !images.includes(url)) {
        images.push(url);
      }
    });

    return images;
  }

  /**
   * 切换到上一张或下一张图片
   * @param {number} direction -1 为上一张，1 为下一张
   */
  function switchImage(direction) {
    if (currentImageList.length <= 1) return;

    const newIndex = currentImageIndex + direction;
    if (newIndex < 0 || newIndex >= currentImageList.length) return;

    currentImageIndex = newIndex;
    const newUrl = currentImageList[currentImageIndex];

    // 更新预览内容
    if (previewElement && isPreviewVisible) {
      const previewImg = previewElement.querySelector('.x-preview-image');
      const previewGif = previewElement.querySelector('.x-preview-gif');
      const loading = previewElement.querySelector('.x-preview-loading');

      previewImg.style.display = 'none';
      previewGif.style.display = 'none';
      loading.style.display = 'flex';

      currentPreviewImg = newUrl;
      const previewUrl = getPreviewUrl(newUrl) || newUrl;

      previewImg.onload = () => {
        loading.style.display = 'none';
        previewImg.style.display = 'block';
      };
      previewImg.src = previewUrl;

      // 更新切换按钮状态
      updateNavigationButtons();
    }
  }

  /**
   * 更新切换按钮的显示状态
   */
  function updateNavigationButtons() {
    if (!previewElement || !getPreviewFollowMouse()) return;

    const prevBtn = previewElement.querySelector('.x-preview-prev');
    const nextBtn = previewElement.querySelector('.x-preview-next');

    if (prevBtn) {
      prevBtn.style.opacity = currentImageIndex > 0 ? '1' : '0.3';
      prevBtn.style.pointerEvents = currentImageIndex > 0 ? 'auto' : 'none';
    }
    if (nextBtn) {
      nextBtn.style.opacity = currentImageIndex < currentImageList.length - 1 ? '1' : '0.3';
      nextBtn.style.pointerEvents = currentImageIndex < currentImageList.length - 1 ? 'auto' : 'none';
    }
  }

  /**
   * 显示或隐藏跟随模式下的操作按钮
   */
  function toggleFollowModeActions(show) {
    if (!previewElement || !getPreviewFollowMouse()) return;

    const actions = previewElement.querySelector('.x-preview-actions-follow');
    if (actions) {
      actions.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * 获取视频 URL
   * @param {HTMLVideoElement} videoElement 视频元素
   * @param {boolean} allowBlob 是否允许返回 blob URL（用于 GIF 预览）
   */
  function getVideoPlaylistUrl(videoElement, allowBlob = false) {
    // 优先检查 video 元素自身的 src
    if (videoElement.src && videoElement.src.includes('video.twimg.com')) {
      if (!videoElement.src.startsWith('blob:') || allowBlob) {
        return videoElement.src;
      }
    }

    // 检查 source 子元素
    const sources = videoElement.querySelectorAll('source');
    for (const source of sources) {
      if (source.src && source.src.includes('video.twimg.com')) {
        if (!source.src.startsWith('blob:') || allowBlob) {
          return source.src;
        }
      }
    }

    // GIF 预览场景下，允许回退到 blob URL
    if (allowBlob && videoElement.src && videoElement.src.startsWith('blob:')) {
      return videoElement.src;
    }

    return null;
  }

  /**
   * 妫€鏌ユ槸鍚︽槸GIF
   */
  function isGifVideo(videoElement) {
    const hasLoop = videoElement.loop;
    const hasMuted = videoElement.muted;
    const container = videoElement.closest('[data-testid="tweetPhoto"]');
    const hasControls = !!videoElement.controls;
    const hasAutoplay = !!videoElement.autoplay;
    const poster = videoElement.getAttribute('poster') || '';

    if (container) {
      const gifBadge = container.querySelector('[class*="GIF"], [class*="gif"], [aria-label*="GIF"], [aria-label*="gif"]');
      if (gifBadge) return true;

      const containerText = container.textContent || '';
      if (containerText.toLowerCase().includes('gif')) return true;

      const rect = container.getBoundingClientRect();
      if (hasLoop && rect.width < 400 && rect.height < 400) return true;
    }

    if (videoElement.hasAttribute('data-is-gif') || videoElement.getAttribute('data-testid')?.includes('gif')) {
      return true;
    }

    const ariaLabel = videoElement.getAttribute('aria-label') || '';
    if (ariaLabel.toLowerCase().includes('gif')) return true;

    const parentWithGifClass = videoElement.closest('[class*="gif-wrapper"], [class*="gif-container"], [data-testid*="gif"]');
    if (parentWithGifClass) return true;

    // X 上的 GIF 往往表现为“无控件 + 循环自动播放”的 mp4
    if (hasLoop && hasAutoplay && !hasControls) return true;
    if (poster.includes('tweet_video_thumb')) return true;

    // 回退策略：普通视频通常会显示视频控件
    if (hasLoop && !hasControls) return true;

    if (!hasMuted && hasLoop) return false;

    return hasLoop && hasMuted;
  }

  /**
   * 创建下载按钮
   */
  function createDownloadButton(imageUrl, isVideo = false, videoElement = null, isGif = false) {
    const btn = document.createElement('div');

    if (isGif) {
      btn.className = CONFIG.GIF_BUTTON_CLASS;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M11.5 9H13v6h-1.5zM9 9H7.5v6H9V9zM21 6v12c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2zm-2 0H5v12h14V6z"/></svg>`;
      btn.title = '下载GIF';
    } else if (isVideo) {
      btn.className = CONFIG.VIDEO_BUTTON_CLASS;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
      btn.title = '下载视频';
    } else {
      btn.className = CONFIG.BUTTON_CLASS;
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
      btn.title = '下载图片';
    }

    if (!isVideo && !isGif && imageUrl) {
      btn.addEventListener('mouseenter', (e) => showQualityMenu(btn, imageUrl, e));
      btn.addEventListener('mouseleave', () => scheduleHideQualityMenu());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadImage(imageUrl, '4096x4096', 'manual');
      });
    } else if ((isGif || isVideo) && videoElement) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleVideoDownload(videoElement, btn, isGif, 'manual');
      });
    }

    return btn;
  }

  // 菜单隐藏定时器
  let qualityMenuHideTimer = null;

  /**
   * 显示画质菜单
   */
  function showQualityMenu(btn, imageUrl) {
    // 取消任何待执行的隐藏操作
    if (qualityMenuHideTimer) {
      clearTimeout(qualityMenuHideTimer);
      qualityMenuHideTimer = null;
    }

    hideQualityMenu();
    const menu = document.createElement('div');
    menu.className = 'x-quality-menu';
    menu.id = 'x-quality-menu';

    CONFIG.QUALITY_OPTIONS.forEach(option => {
      const item = document.createElement('div');
      item.className = 'x-quality-item';
      item.innerHTML = `<span class="x-quality-name">${option.label}</span><span class="x-quality-desc">${option.desc}</span>`;
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        downloadImage(imageUrl, option.name, 'manual');
        hideQualityMenu();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    const btnRect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${btnRect.bottom + 5}px`;
    menu.style.left = `${btnRect.left}px`;

    // 鼠标进入菜单时取消隐藏
    menu.addEventListener('mouseenter', () => {
      if (qualityMenuHideTimer) {
        clearTimeout(qualityMenuHideTimer);
        qualityMenuHideTimer = null;
      }
    });

    // 鼠标离开菜单时隐藏
    menu.addEventListener('mouseleave', () => scheduleHideQualityMenu());
  }

  /**
   * 延迟隐藏菜单
   */
  function scheduleHideQualityMenu() {
    qualityMenuHideTimer = setTimeout(() => {
      hideQualityMenu();
    }, 100);
  }

  function hideQualityMenu() {
    document.getElementById('x-quality-menu')?.remove();
    if (qualityMenuHideTimer) {
      clearTimeout(qualityMenuHideTimer);
      qualityMenuHideTimer = null;
    }
  }

  /**
   * 下载图片
   */
  function downloadImage(imageUrl, quality, source = 'manual') {
    if (!quality) {
      quality = getImageQuality();
    }
    const downloadUrl = getImageUrl(imageUrl, quality);
    if (downloadUrl) {
      chrome.runtime.sendMessage({
        action: 'downloadImage',
        url: downloadUrl,
        filename: getFileName(imageUrl, quality),
        source
      }, (response) => {
        showNotification(response?.success ? `开始下载 ${quality} 画质图片...` : '下载失败', response?.success ? 'success' : 'error');
      });
    }
  }

  /**
   * 处理视频下载
   */
  function handleVideoDownload(videoElement, btn, isGif = false, source = 'manual') {
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="x-loading-spinner"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>`;

    const tweetId = extractTweetId(videoElement);
    const directVideoUrl = getVideoPlaylistUrl(videoElement);

    console.log('[X下载器] 请求:', { tweetId, directVideoUrl, isGif, source });

    chrome.runtime.sendMessage({
      action: 'downloadVideo',
      tweetId: tweetId,
      directVideoUrl: directVideoUrl,
      pageUrl: window.location.href,
      isGif: isGif,
      source
    }, (response) => {
      btn.innerHTML = originalContent;
      console.log('[X下载器] 响应:', response);
      showNotification(response?.success ? '开始下载...' : (response?.error || '下载失败'), response?.success ? 'success' : 'error');
    });
  }

  /**
   * 创建预览窗口
   */
  function createPreviewElement() {
    if (previewElement) return previewElement;

    const isFollowMode = getPreviewFollowMouse();

    previewElement = document.createElement('div');
    previewElement.className = CONFIG.PREVIEW_CLASS;

    // 根据是否跟随鼠标决定 HTML 结构
    if (isFollowMode) {
      previewElement.innerHTML = `
        <div class="x-preview-content x-preview-follow-mode">
          <img class="x-preview-image" src="" alt="预览" draggable="false">
          <video class="x-preview-gif" src="" autoplay loop muted playsinline style="display:none;"></video>
          <div class="x-preview-loading"><div class="x-preview-spinner"></div><span>加载中...</span></div>
          <div class="x-preview-scale-info" style="display:none;">100%</div>
          <div class="x-preview-actions-follow" style="display:none;">
            <button class="x-preview-btn x-preview-prev" title="上一张 (←)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <button class="x-preview-btn x-preview-download" title="下载">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </button>
            <button class="x-preview-btn x-preview-close" title="关闭 (ESC)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
            <button class="x-preview-btn x-preview-next" title="下一张 (→)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="m8.59 16.59 1.41 1.41 6-6-6-6-1.41 1.41L13.17 12z"/></svg>
            </button>
          </div>
          <div class="x-preview-follow-hint">空格固定 | Alt+滚轮缩放</div>
        </div>
      `;
    } else {
      previewElement.innerHTML = `
        <div class="x-preview-content">
          <img class="x-preview-image" src="" alt="预览" draggable="false">
          <video class="x-preview-gif" src="" autoplay loop muted playsinline style="display:none;"></video>
          <div class="x-preview-loading"><div class="x-preview-spinner"></div><span>加载中...</span></div>
          <div class="x-preview-scale-info">100%</div>
          <div class="x-preview-actions">
            <div class="x-preview-download-wrapper">
              <button class="x-preview-btn x-preview-download" title="下载">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              </button>
              <div class="x-preview-quality-menu"></div>
            </div>
            <button class="x-preview-btn x-preview-close" title="关闭 (ESC)">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
          <div class="x-preview-hint">拖动移动 | 滚轮缩放 | ESC关闭</div>
        </div>
      `;
    }

    document.body.appendChild(previewElement);

    const content = previewElement.querySelector('.x-preview-content');

    // 跟随鼠标模式：初始设置 pointer-events 为 none
    if (isFollowMode) {
      previewElement.style.pointerEvents = 'none';

      // 跟随鼠标模式下支持滚轮缩放
      // 固定后不需要 Alt，未固定时需要 Alt
      previewElement.addEventListener('wheel', (e) => {
        if (!isPreviewVisible) return;
        // 固定状态下直接缩放，未固定时需要 Alt
        if (!isPreviewPinned && !e.altKey) return;

        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        previewScale = Math.max(0.5, Math.min(3.0, previewScale + delta));

        const content = previewElement.querySelector('.x-preview-content');
        content.style.width = `${basePreviewWidth * previewScale}px`;
        content.style.height = `${basePreviewHeight * previewScale}px`;

        const scaleInfo = previewElement.querySelector('.x-preview-scale-info');
        scaleInfo.textContent = `${Math.round(previewScale * 100)}%`;
        scaleInfo.style.display = 'block';
        setTimeout(() => { scaleInfo.style.display = 'none'; }, 1500);
      }, { passive: false });

      // 跟随鼠标模式下支持拖动（仅固定状态生效）
      previewElement.addEventListener('mousedown', (e) => {
        if (!isPreviewPinned || !isPreviewVisible) return;

        // 点击的是按钮时，不触发拖动
        if (e.target.closest('.x-preview-btn')) return;

        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        previewStartX = parseInt(previewElement.style.left) || 0;
        previewStartY = parseInt(previewElement.style.top) || 0;
        content.style.cursor = 'grabbing';
        e.preventDefault();
      });

      // 跟随鼠标模式下的按钮事件
      const closeBtnFollow = previewElement.querySelector('.x-preview-close');
      const downloadBtnFollow = previewElement.querySelector('.x-preview-download');
      const prevBtn = previewElement.querySelector('.x-preview-prev');
      const nextBtn = previewElement.querySelector('.x-preview-next');

      if (closeBtnFollow) {
        closeBtnFollow.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          hidePreview(0);
        });
      }

      if (downloadBtnFollow) {
        downloadBtnFollow.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (currentPreviewImg) {
            downloadImage(currentPreviewImg, '4096x4096', 'manual');
          }
        });
      }

      updatePreviewHint();

      if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchImage(-1);
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          switchImage(1);
        });
      }

      return previewElement;
    }

    // 普通模式：添加交互事件
    // 鼠标进入预览窗口时取消隐藏
    previewElement.addEventListener('mouseenter', () => {
      isTransitioningToPreview = false; // 过渡完成
      cancelHidePreview();
    });

    // 鼠标离开时隐藏；如果仍处于过渡阶段则忽略
    previewElement.addEventListener('mouseleave', (e) => {
      // 如果正在从图片移动到预览窗口，忽略此次 mouseleave
      if (isTransitioningToPreview) {
        return;
      }
      hidePreview(200);
    });

    const closeBtn = previewElement.querySelector('.x-preview-close');
    const downloadBtn = previewElement.querySelector('.x-preview-download');
    const qualityMenu = previewElement.querySelector('.x-preview-quality-menu');

    closeBtn.addEventListener('click', () => hidePreview(0));

    downloadBtn.addEventListener('mouseenter', () => {
      qualityMenu.innerHTML = '';
      CONFIG.QUALITY_OPTIONS.forEach(option => {
        const item = document.createElement('div');
        item.className = 'x-preview-quality-item';
        item.textContent = option.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentPreviewImg) downloadImage(currentPreviewImg, option.name, 'manual');
        });
        qualityMenu.appendChild(item);
      });
      qualityMenu.style.display = 'block';
    });

    downloadBtn.addEventListener('mouseleave', () => {
      setTimeout(() => { if (!qualityMenu.matches(':hover')) qualityMenu.style.display = 'none'; }, 100);
    });

    qualityMenu.addEventListener('mouseleave', () => { qualityMenu.style.display = 'none'; });

    downloadBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (currentPreviewImg) downloadImage(currentPreviewImg, '4096x4096', 'manual');
    });

    // 拖动功能
    content.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      previewStartX = parseInt(previewElement.style.left) || 0;
      previewStartY = parseInt(previewElement.style.top) || 0;
      content.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      previewElement.style.left = `${previewStartX + dx}px`;
      previewElement.style.top = `${previewStartY + dy}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        content.style.cursor = 'grab';
      }
    });

    // 滚轮缩放
    previewElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      previewScale = Math.max(0.5, Math.min(2.5, previewScale + delta));

      content.style.width = `${basePreviewWidth * previewScale}px`;
      content.style.height = `${basePreviewHeight * previewScale}px`;

      const scaleInfo = previewElement.querySelector('.x-preview-scale-info');
      scaleInfo.textContent = `${Math.round(previewScale * 100)}%`;
      scaleInfo.style.display = 'block';
      setTimeout(() => { scaleInfo.style.display = 'none'; }, 1500);
    }, { passive: false });

    return previewElement;
  }

  /**
   * 更新预览内容（即时切换，不关闭窗口）
   */
  function updatePreviewContent(imageUrl, x, y, isGif = false, gifUrl = null) {
    const preview = createPreviewElement();
    const previewImg = preview.querySelector('.x-preview-image');
    const previewGif = preview.querySelector('.x-preview-gif');
    const loading = preview.querySelector('.x-preview-loading');
    const content = preview.querySelector('.x-preview-content');

    previewImg.style.display = 'none';
    previewGif.style.display = 'none';
    loading.innerHTML = '<div class="x-preview-spinner"></div><span>加载中...</span>';
    loading.style.display = 'flex';
    content.style.cursor = 'grab';

    previewScale = 1;
    const token = ++previewLoadToken;

    if (isGif && gifUrl) {
      currentPreviewImg = null;
      currentPreviewGif = gifUrl;

      const onGifReady = () => {
        if (token !== previewLoadToken) return;
        loading.style.display = 'none';
        previewGif.style.display = 'block';
        positionPreview(preview, previewGif, x, y);
      };
      previewGif.onerror = () => {
        if (token !== previewLoadToken) return;
        loading.innerHTML = '<span>加载失败</span>';
      };
      previewGif.addEventListener('loadeddata', onGifReady, { once: true });
      previewGif.addEventListener('canplay', onGifReady, { once: true });
      previewGif.src = gifUrl;
      previewGif.load();
    } else {
      currentPreviewImg = imageUrl;
      currentPreviewGif = null;

      const previewUrl = getPreviewUrl(imageUrl) || imageUrl;

      previewImg.onload = () => {
        if (token !== previewLoadToken) return;
        loading.style.display = 'none';
        previewImg.style.display = 'block';
        positionPreview(preview, previewImg, x, y);
      };
      previewImg.onerror = () => {
        if (token !== previewLoadToken) return;
        loading.innerHTML = '<span>加载失败</span>';
      };
      previewImg.src = previewUrl;
    }

    // 立即显示，无需动画
    preview.classList.add('x-preview-visible');
    isPreviewVisible = true;
    updatePreviewHint();
  }

  /**
   * 显示预览（兼容旧接口）
   */
  function showPreview(imageUrl, x, y, isGif = false, gifUrl = null) {
    // 如果预览窗口已经显示，直接更新内容
    if (isPreviewVisible && currentPreviewUrl !== imageUrl) {
      updatePreviewContent(imageUrl, x, y, isGif, gifUrl);
      return;
    }

    currentPreviewUrl = imageUrl;

    // 获取当前推文中的所有图片
    if (activePreviewTarget) {
      currentImageList = getTweetImages(activePreviewTarget);
      currentImageIndex = currentImageList.indexOf(imageUrl);
      if (currentImageIndex < 0) currentImageIndex = 0;
    } else {
      currentImageList = [imageUrl];
      currentImageIndex = 0;
    }

    updatePreviewContent(imageUrl, x, y, isGif, gifUrl);
  }

  function getFollowPreviewPosition(x, y, previewWidth, previewHeight) {
    const margin = 20;
    const viewport = { width: window.innerWidth, height: window.innerHeight };

    const rightLeft = x + 20;
    const leftLeft = x - previewWidth - 20;
    const rightFits = rightLeft + previewWidth <= viewport.width - margin;
    const leftFits = leftLeft >= margin;

    // 仅在当前停靠侧不可用时切换，避免左右晃动时突然跳边
    if (previewFollowSide === 'right' && !rightFits && leftFits) {
      previewFollowSide = 'left';
    } else if (previewFollowSide === 'left' && !leftFits && rightFits) {
      previewFollowSide = 'right';
    }

    let left = previewFollowSide === 'left' ? leftLeft : rightLeft;
    const minLeft = margin;
    const maxLeft = Math.max(margin, viewport.width - previewWidth - margin);
    left = Math.min(Math.max(left, minLeft), maxLeft);

    let top = y + 20;
    const minTop = margin;
    const maxTop = Math.max(margin, viewport.height - previewHeight - margin);
    top = Math.min(Math.max(top, minTop), maxTop);

    return { left, top };
  }

  function moveFollowPreviewToCursor(x, y) {
    if (!previewElement) return;
    const previewWidth = basePreviewWidth * previewScale;
    const previewHeight = basePreviewHeight * previewScale;
    const pos = getFollowPreviewPosition(x, y, previewWidth, previewHeight);
    previewElement.style.left = `${pos.left}px`;
    previewElement.style.top = `${pos.top}px`;
  }

  /**
   * 定位预览窗口
   */
  function positionPreview(preview, mediaElement, x, y) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const isFollowMode = getPreviewFollowMouse();

    let naturalWidth, naturalHeight;
    if (mediaElement.tagName === 'VIDEO') {
      naturalWidth = mediaElement.videoWidth || 400;
      naturalHeight = mediaElement.videoHeight || 300;
    } else {
      naturalWidth = mediaElement.naturalWidth;
      naturalHeight = mediaElement.naturalHeight;
    }

    // 跟随鼠标模式：尽量放大预览窗口，并贴近浏览器上下边缘
    const margin = 10; // 上下预留 10px 边距
    const maxHeight = viewport.height - margin * 2;
    const maxWidth = isFollowMode ? Math.min(viewport.width * 0.7, 900) : Math.min(viewport.width * 0.7, 800);

    let displayWidth = naturalWidth;
    let displayHeight = naturalHeight;
    const aspectRatio = naturalWidth / naturalHeight;

    // 先按最大高度缩放
    if (displayHeight > maxHeight || isFollowMode) {
      displayHeight = maxHeight;
      displayWidth = displayHeight * aspectRatio;
    }
    // 再限制宽度
    if (displayWidth > maxWidth) {
      displayWidth = maxWidth;
      displayHeight = displayWidth / aspectRatio;
    }

    displayWidth = Math.max(displayWidth, isFollowMode ? 280 : 200);
    displayHeight = Math.max(displayHeight, isFollowMode ? 200 : 150);

    basePreviewWidth = displayWidth;
    basePreviewHeight = displayHeight;

    // 跟随鼠标模式：优先保持初始停靠侧，避免在边界附近抖动跳边
    let left, top;
    if (isFollowMode) {
      const rightLeft = x + 20;
      const leftLeft = x - displayWidth - 20;
      const rightFits = rightLeft + displayWidth <= viewport.width - margin;
      const leftFits = leftLeft >= margin;
      previewFollowSide = rightFits || !leftFits ? 'right' : 'left';
      const pos = getFollowPreviewPosition(x, y, displayWidth, displayHeight);
      left = pos.left;
      top = pos.top;
    } else {
      left = x + 25;
      top = y - displayHeight / 2;
    }

    if (!isFollowMode) {
      if (left + displayWidth > viewport.width - margin) left = x - displayWidth - 20;
      if (left < margin) left = margin;
      if (top < margin) top = margin;
      if (top + displayHeight > viewport.height - margin) top = viewport.height - displayHeight - margin;
    }

    const content = preview.querySelector('.x-preview-content');
    content.style.width = `${displayWidth}px`;
    content.style.height = `${displayHeight}px`;
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }

  /**
   * 闅愯棌预览
   */
  function hidePreview(delay = 0) {
    if (previewHideTimer) {
      clearTimeout(previewHideTimer);
    }

    if (delay === 0) {
      doHidePreview();
      return;
    }

    previewHideTimer = setTimeout(() => {
      doHidePreview();
    }, delay);
  }

  function doHidePreview() {
    if (previewElement) {
      previewElement.classList.remove('x-preview-visible');
      // 重置 pointer-events 为 none（跟随鼠标模式）
      if (getPreviewFollowMouse()) {
        previewElement.style.pointerEvents = 'none';
        // 隐藏操作按钮
        toggleFollowModeActions(false);
      }
      const previewGif = previewElement.querySelector('.x-preview-gif');
      previewGif.pause();
      previewGif.src = '';
    }
    previewLoadToken++;
    currentPreviewUrl = null;
    currentPreviewImg = null;
    currentPreviewGif = null;
    previewScale = 1;
    isPreviewVisible = false;
    previewHideTimer = null;
    activePreviewTarget = null;
    isTransitioningToPreview = false; // 重置过渡状态
    isPreviewPinned = false; // 重置固定状态
    currentImageList = []; // 重置图片列表
    currentImageIndex = 0; // 重置图片索引
    previewFollowSide = 'right';
  }

  /**
   * 取消隐藏预览
   */
  function cancelHidePreview() {
    if (previewHideTimer) {
      clearTimeout(previewHideTimer);
      previewHideTimer = null;
    }
  }

  /**
   * 显示通知
   */
  function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `x-download-notification x-download-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function isImageProcessed(container) {
    return container.hasAttribute(CONFIG.IMAGE_PROCESSED_ATTR);
  }

  function markImageProcessed(container) {
    container.setAttribute(CONFIG.IMAGE_PROCESSED_ATTR, 'true');
  }

  function isVideoProcessed(container) {
    return container.hasAttribute(CONFIG.VIDEO_PROCESSED_ATTR);
  }

  function markVideoProcessed(container) {
    container.setAttribute(CONFIG.VIDEO_PROCESSED_ATTR, 'true');
  }

  /**
   * 处理图片容器
   */
  function processImageContainer(container) {
    const img = container.querySelector('img[src*="pbs.twimg.com/media"]');
    if (!img || isImageProcessed(container)) return;
    // GIF 容器通常同时包含 video 和首帧图，避免被图片流程抢先处理
    if (container.querySelector('video')) return;

    const imageUrl = img.src;
    if (!imageUrl) return;

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const btn = createDownloadButton(imageUrl);
    container.appendChild(btn);

    markImageProcessed(container);
    setupImagePreview(img, container);
  }

  /**
   * 设置图片预览 - 即时切换版本
   */
  function setupImagePreview(img, container) {
    if (!getEnablePreview() || !getEnableImagePreview()) return;

    // 跟随鼠标模式的鼠标移动处理器
    let mouseMoveHandler = null;

    img.addEventListener('mouseenter', (e) => {
      // 检查触发条件
      if (!checkTriggerCondition(e)) return;
      if (isHoveringPreviewExcludedControl(container, e)) return;

      // 如果在大图查看器中，不显示预览
      if (isInImageViewer) return;

      // 取消任何待执行的隐藏操作
      cancelHidePreview();
      activePreviewTarget = container;

      // 如果预览窗口已经显示，直接更新内容
      if (isPreviewVisible && img.src.includes('pbs.twimg.com/media')) {
        updatePreviewContent(img.src, e.clientX, e.clientY);
        return;
      }

      // 否则显示新预览
      if (!isPreviewVisible && img.src.includes('pbs.twimg.com/media')) {
        previewTimeout = setTimeout(() => {
          // 再次检查是否在大图查看器或悬停到下载控件上
          if (isInImageViewer || isHoveringPreviewExcludedControl(container, e)) return;

          showPreview(img.src, e.clientX, e.clientY);

          // 跟随鼠标模式：添加鼠标移动监听器
          if (getPreviewFollowMouse() && previewElement) {
            mouseMoveHandler = (moveEvent) => {
              if (previewElement && isPreviewVisible) {
                // 如果预览窗口被固定，不更新位置
                if (isPreviewPinned) return;
                moveFollowPreviewToCursor(moveEvent.clientX, moveEvent.clientY);
              }
            };
            document.addEventListener('mousemove', mouseMoveHandler);
          }
        }, CONFIG.PREVIEW_DELAY);
      }
    });


    img.addEventListener('mouseleave', () => {
      if (previewTimeout) {
        clearTimeout(previewTimeout);
        previewTimeout = null;
      }

      // 移除鼠标移动监听器
      if (mouseMoveHandler) {
        document.removeEventListener('mousemove', mouseMoveHandler);
        mouseMoveHandler = null;
      }

      // 跟随鼠标模式：如果预览窗口被固定，不隐藏
      if (getPreviewFollowMouse()) {
        if (!isPreviewPinned) {
          hidePreview(0);
          activePreviewTarget = null;
        }
      } else {
        // 普通模式：设置过渡状态，延迟隐藏，给用户时间移动到预览窗口
        isTransitioningToPreview = true;
        hidePreview(300);
        activePreviewTarget = null;
      }
    });
  }

  /**
   * 处理视频容器
   */
  function processVideoContainer(container, videoElement = null, forcedIsGif = null) {
    if (isVideoProcessed(container)) return;

    const video = videoElement || container.querySelector('video');
    if (!video) return;

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const isGif = forcedIsGif !== null ? forcedIsGif : isGifVideo(video);
    const btn = createDownloadButton(null, !isGif, video, isGif);
    container.appendChild(btn);

    markVideoProcessed(container);

    if (isGif) {
      setupGifPreview(video, container);
    }
  }

  /**
   * 设置 GIF 预览 - 即时切换版本
   */
  function setupGifPreview(video, container) {
    if (!getEnablePreview() || !getEnableGifPreview()) return;
    // 跟随鼠标模式的鼠标移动处理器
    let mouseMoveHandler = null;

    video.addEventListener('mouseenter', (e) => {
      if (!checkTriggerCondition(e)) return;
      if (isHoveringPreviewExcludedControl(container, e)) return;

      // 如果在大图查看器中，不显示预览
      if (isInImageViewer) return;

      cancelHidePreview();
      activePreviewTarget = container;

      // 对于 GIF 预览，允许使用 blob URL
      const videoUrl = getVideoPlaylistUrl(video, true);
      if (!videoUrl) return;

      if (isPreviewVisible) {
        updatePreviewContent(null, e.clientX, e.clientY, true, videoUrl);
        return;
      }

      if (!isPreviewVisible) {
        previewTimeout = setTimeout(() => {
          // 再次检查是否在大图查看器或悬停到下载控件上
          if (isInImageViewer || isHoveringPreviewExcludedControl(container, e)) return;

          showPreview(null, e.clientX, e.clientY, true, videoUrl);

          // 跟随鼠标模式：添加鼠标移动监听器
          if (getPreviewFollowMouse() && previewElement) {
            mouseMoveHandler = (moveEvent) => {
              if (previewElement && isPreviewVisible) {
                // 如果预览窗口被固定，不更新位置
                if (isPreviewPinned) return;
                moveFollowPreviewToCursor(moveEvent.clientX, moveEvent.clientY);
              }
            };
            document.addEventListener('mousemove', mouseMoveHandler);
          }
        }, CONFIG.PREVIEW_DELAY);
      }
    });


    video.addEventListener('mouseleave', () => {
      if (previewTimeout) {
        clearTimeout(previewTimeout);
        previewTimeout = null;
      }

      // 移除鼠标移动监听器
      if (mouseMoveHandler) {
        document.removeEventListener('mousemove', mouseMoveHandler);
        mouseMoveHandler = null;
      }

      // 跟随鼠标模式：如果预览窗口被固定，不隐藏
      if (getPreviewFollowMouse()) {
        if (!isPreviewPinned) {
          hidePreview(0);
          activePreviewTarget = null;
        }
      } else {
        // 普通模式：设置过渡状态，延迟隐藏，给用户时间移动到预览窗口
        isTransitioningToPreview = true;
        hidePreview(300);
        activePreviewTarget = null;
      }
    });
  }

  /**
   * 劫持官方下载按钮
   */
  function hijackPremiumDownloadButtons() {
    const downloadButtons = document.querySelectorAll([
      '[data-testid="download"]',
      'button[aria-label*="下载"]',
      'button[aria-label*="Download"]',
      '[data-testid="caret"]'
    ].join(','));

    downloadButtons.forEach(btn => {
      if (btn.hasAttribute('data-x-hijacked')) return;
      btn.setAttribute('data-x-hijacked', 'true');

      if (btn.getAttribute('data-testid') === 'caret') {
        btn.addEventListener('click', () => {
          setTimeout(hijackDownloadMenuItem, 100);
        });
      }
    });
  }

  /**
   * 劫持下载菜单
   */
  function hijackDownloadMenuItem() {
    const menuItems = document.querySelectorAll('[role="menuitem"]');

    menuItems.forEach(item => {
      const text = item.textContent?.toLowerCase() || '';
      const isDownloadItem = text.includes('download') || text.includes('下载') ||
        item.querySelector('svg path[d*="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"]');

      if (isDownloadItem && !item.hasAttribute('data-x-hijacked')) {
        item.setAttribute('data-x-hijacked', 'true');

        const article = item.closest('article') || document.querySelector('article');
        if (!article) return;

        const video = article.querySelector('video');
        const img = article.querySelector('img[src*="pbs.twimg.com/media"]');

        if (video || img) {
          const newBtn = item.cloneNode(true);
          newBtn.setAttribute('data-x-hijacked', 'true');

          newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (video) {
              const tweetId = extractTweetId(video);
              const directVideoUrl = getVideoPlaylistUrl(video);
              const isGif = isGifVideo(video);
              showNotification('正在获取视频...', 'success');
              chrome.runtime.sendMessage({
                action: 'downloadVideo',
                tweetId: tweetId,
                directVideoUrl: directVideoUrl,
                pageUrl: window.location.href,
                isGif: isGif,
                source: 'manual'
              }, (response) => {
                showNotification(response?.success ? '开始下载...' : (response?.error || '下载失败'), response?.success ? 'success' : 'error');
              });
            } else if (img) {
              downloadImage(img.src, '4096x4096');
            }

            item.closest('[role="menu"]')?.remove();
          }, true);

          item.parentNode.replaceChild(newBtn, item);
        }
      }
    });
  }

  /**
   * 处理图片
   */
  function processImage(img) {
    if (!img.src || !img.src.includes('pbs.twimg.com/media')) return;

    let container = img.closest('[data-testid="tweetPhoto"]') ||
      img.closest('[data-testid="card.wrapper"]') ||
      img.closest('a[href*="/photo/"]') ||
      img.closest('div[data-testid="previewInterstitial"]') ||
      img.parentElement?.parentElement;

    if (container && !isImageProcessed(container)) {
      processImageContainer(container);
    }
  }

  /**
   * 处理视频
   */
  function processVideo(video) {
    const selectors = [
      '[data-testid="videoComponent"]',
      '[data-testid="tweetPhoto"]',
      '[data-testid="videoPlayer"]',
      'div[data-testid="previewInterstitial"]',
      'div[aria-label*="Video"]',
      'div[aria-label*="GIF"]',
      'div[role="group"]',
      'article',
      'div[class*="r-1habvwh"]',
      'div[style*="padding-bottom"]'
    ];

    let container = null;
    for (const selector of selectors) {
      try {
        container = video.closest(selector);
        if (container) break;
      } catch (e) {
        continue;
      }
    }

    if (!container) {
      container = video.parentElement?.parentElement || video.parentElement;
    }

    if (container && !isVideoProcessed(container)) {
      const isGif = isGifVideo(video);
      processVideoContainer(container, video, isGif);
    }
  }

  /**
   * 扫描媒体
   */
  function scanMedia() {
    document.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach(processImage);
    document.querySelectorAll('video').forEach(processVideo);
    hijackPremiumDownloadButtons();
  }

  /**
   * 批量下载澶勭悊
   */
  function handleBatchDownload(filters) {
    const batchSettings = normalizeBatchSettings(filters, userSettings.imageQuality);
    if (!batchSettings.types.image && !batchSettings.types.video && !batchSettings.types.gif) {
      showNotification('请至少选择一种媒体类型', 'error');
      return;
    }

    persistBatchSettings(batchSettings);

    const results = [];

    // 扫描所有媒体
    const images = document.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    const videos = document.querySelectorAll('video');

    images.forEach((img) => {
      if (!batchSettings.types.image || !img.src.includes('pbs.twimg.com/media')) return;

      const article = img.closest('article');
      const dateValue = article?.querySelector('time')?.getAttribute('datetime');
      const date = dateValue ? new Date(dateValue) : new Date();
      const tweetId = extractTweetId(img);
      const url = getImageUrl(img.src, batchSettings.quality) || img.src;

      results.push({
        type: 'image',
        url,
        date,
        tweetId,
        userName: BatchDownloader.getUserNameFromItem(img)
      });
    });

    videos.forEach((video) => {
      const article = video.closest('article');
      const dateValue = article?.querySelector('time')?.getAttribute('datetime');
      const date = dateValue ? new Date(dateValue) : new Date();
      const tweetId = extractTweetId(video);
      const isGif = isGifVideo(video);

      if (isGif && batchSettings.types.gif) {
        const videoUrl = getVideoPlaylistUrl(video);
        if (videoUrl) {
          results.push({
            type: 'gif',
            url: videoUrl,
            date,
            tweetId,
            userName: BatchDownloader.getUserNameFromItem(video)
          });
        }
      } else if (!isGif && batchSettings.types.video && tweetId) {
        results.push({
          type: 'video',
          tweetId,
          date,
          userName: BatchDownloader.getUserNameFromItem(video)
        });
      }
    });

    const filteredResults = results.filter((item) => BatchDownloader.matchesDateRange(item, batchSettings.dateRange));

    // 发送下载任务
    let completed = 0;
    const total = filteredResults.length;

    if (total === 0) {
      showNotification('未找到符合条件的媒体', 'error');
      return;
    }

    showNotification(`开始批量下载 ${total} 个文件...`, 'success');

    filteredResults.forEach((item, index) => {
      setTimeout(() => {
        BatchDownloader.triggerDownload(item, batchSettings);

        completed++;
        if (completed === total) {
          showNotification(`批量下载完成！共 ${total} 个文件`, 'success');
        }
      }, index * 500); // 500ms 间隔，避免限流
    });
  }

  /**
   * 初始化 Observer
   */
  function initObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'IMG') processImage(node);
              else if (node.tagName === 'VIDEO') processVideo(node);
              else {
                node.querySelectorAll?.('img[src*="pbs.twimg.com/media"]')?.forEach(processImage);
                node.querySelectorAll?.('video')?.forEach(processVideo);
              }

              if (node.getAttribute?.('role') === 'menu') {
                setTimeout(hijackDownloadMenuItem, 50);
              }
            }
          });
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  /**
   * 初始化全局监听
   */
  function initGlobalListeners() {
    document.addEventListener('mouseover', (e) => {
      if (e.target.tagName === 'IMG' && e.target.src?.includes('pbs.twimg.com/media')) {
        processImage(e.target);
      }
      if (e.target.tagName === 'VIDEO') {
        processVideo(e.target);
      }
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hidePreview(0);
        hideQualityMenu();
        // ESC 键也会取消固定状态
        if (isPreviewPinned) {
          isPreviewPinned = false;
          // 恢复 pointer-events 为 none
          if (previewElement && getPreviewFollowMouse()) {
            previewElement.style.pointerEvents = 'none';
            // 隐藏操作按钮
            toggleFollowModeActions(false);
          }
          updatePreviewHint();
        }
      }

      // 左右方向键：在跟随鼠标且固定状态下切换图片
      if (getPreviewFollowMouse() && isPreviewPinned && isPreviewVisible) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          switchImage(-1);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          switchImage(1);
          return;
        }
      }

      // 空格键：固定或恢复预览窗口（仅跟随鼠标模式下生效）
      // 使用 e.code 检测空格键，更可靠
      if (e.code === 'Space') {
        const followMouse = getPreviewFollowMouse();
        console.log('[X下载器] 空格键按下, 跟随鼠标模式:', followMouse, '预览可见:', isPreviewVisible);

        if (followMouse && isPreviewVisible) {
          // 阻止默认行为（如页面滚动）
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          isPreviewPinned = !isPreviewPinned;

          // 固定时启用 pointer-events，允许拖动和滚轮缩放
          if (previewElement) {
            previewElement.style.pointerEvents = isPreviewPinned ? 'auto' : 'none';

            // 固定时将鼠标样式设为 grab
            const content = previewElement.querySelector('.x-preview-content');
            if (content) {
              content.style.cursor = isPreviewPinned ? 'grab' : 'default';
            }

            // 显示或隐藏操作按钮
            toggleFollowModeActions(isPreviewPinned);
            if (isPreviewPinned) {
              updateNavigationButtons();
            }
          }

          updatePreviewHint();

          console.log('[X下载器] 固定状态切换为:', isPreviewPinned);
        }
      }
    }, true); // 使用捕获阶段，确保事件优先处理

    // 全局滚轮事件：跟随鼠标模式下缩放
    // 固定状态下可直接缩放，未固定时需要按住 Alt
    document.addEventListener('wheel', (e) => {
      if (!isPreviewVisible || !getPreviewFollowMouse()) return;

      // 固定状态下直接缩放，未固定时需要按住 Alt
      if (!isPreviewPinned && !e.altKey) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      previewScale = Math.max(0.5, Math.min(3.0, previewScale + delta));

      if (previewElement) {
        const content = previewElement.querySelector('.x-preview-content');
        content.style.width = `${basePreviewWidth * previewScale}px`;
        content.style.height = `${basePreviewHeight * previewScale}px`;

        const scaleInfo = previewElement.querySelector('.x-preview-scale-info');
        if (scaleInfo) {
          scaleInfo.textContent = `${Math.round(previewScale * 100)}%`;
          scaleInfo.style.display = 'block';
          setTimeout(() => { scaleInfo.style.display = 'none'; }, 1500);
        }
      }
    }, { passive: false });

    // 全局鼠标移动事件：处理拖动（跟随鼠标且固定状态下）
    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !getPreviewFollowMouse()) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      previewElement.style.left = `${previewStartX + dx}px`;
      previewElement.style.top = `${previewStartY + dy}px`;
    });

    // 全局鼠标释放事件：结束拖动
    document.addEventListener('mouseup', () => {
      if (isDragging && getPreviewFollowMouse()) {
        isDragging = false;
        const content = previewElement?.querySelector('.x-preview-content');
        if (content) content.style.cursor = 'grab';
      }
    });

    // 检测大图查看器
    detectImageViewer();
  }

  /**
   * 更新预览窗口提示文字
   */
  function updatePreviewHint() {
    console.log('[X下载器] updatePreviewHint 调用, previewElement:', !!previewElement, 'followMouse:', getPreviewFollowMouse());
    if (!previewElement) return;
    const hint = previewElement.querySelector('.x-preview-follow-hint');
    console.log('[X下载器] hint元素:', !!hint, 'isPreviewPinned:', isPreviewPinned);
    if (hint) {
      if (isPreviewPinned) {
        const hasMultiple = currentImageList.length > 1;
        if (hasMultiple) {
          hint.textContent = '←→切换 | 拖动移动 | 滚轮缩放 | 空格恢复';
        } else {
          hint.textContent = '拖动移动 | 滚轮缩放 | 空格恢复跟随';
        }
      } else {
        hint.textContent = '空格固定 | Alt+滚轮缩放';
      }
    }
  }

  /**
   * 检测大图查看器
   */
  function detectImageViewer() {
    // X/Twitter 大图查看器的常见特征：
    // 1. URL 变为 /photo/1 或类似格式
    // 2. 页面上出现放大的 tweetPhoto 视图
    // 3. 出现图片查看器对话框或遮罩层

    const checkImageViewer = () => {
      // 检查 URL 是否包含 /photo/
      const isPhotoUrl = window.location.href.includes('/photo/');

      // 检查是否存在大图查看器弹层或对话框
      const hasImageViewerModal = document.querySelector('[data-testid="swipe-to-dismiss"]') ||
        document.querySelector('[data-testid="image-viewer"]') ||
        document.querySelector('[aria-label*="关闭"]')?.closest('[role="dialog"]');

      const wasInImageViewer = isInImageViewer;
      isInImageViewer = isPhotoUrl || !!hasImageViewerModal;

      // 刚进入大图查看器时，立即隐藏预览窗口
      if (!wasInImageViewer && isInImageViewer) {
        hidePreview(0);
        isPreviewPinned = false;
      }
    };

    // 监听 URL 变化（SPA 路由，包括返回上一页）
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        // URL 变化时先关闭预览，避免返回后残留
        if (isPreviewVisible) {
          hidePreview(0);
        }
        checkImageViewer();
      }
    }, 200);

    // 监听浏览器前进/后退按钮
    window.addEventListener('popstate', () => {
      if (isPreviewVisible) {
        hidePreview(0);
      }
    });

    // 监听 DOM 变化，检测查看器弹层
    const observer = new MutationObserver(() => {
      checkImageViewer();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 初始检查
    checkImageViewer();
  }

  // --- 批量下载管理器 ---
  const BatchDownloader = {
    state: {
      scanning: false,
      stopping: false,
      scannedCount: 0,
      downloadCount: 0,
      userName: '',
      prevBodyOverflow: '',
      mediaMap: new Map() // url -> {filename, type, tweetId}
    },

    config: cloneBatchSettings(userSettings.batchSettings),

    ui: {
      btn: null,
      modal: null,
      overlay: null,
      qualityOutsideHandler: null,
      escHandler: null
    },

    init() {
      this.injectStyles();
      // 监听 URL 变化，判断是否显示按钮
      setInterval(() => this.checkPage(), 1000);
    },

    injectStyles() {
      if (document.getElementById('x-batch-style')) return;
      const style = document.createElement('style');
      style.id = 'x-batch-style';
      style.textContent = `
        :root {
          --xui-blue: #1d9bf0;
          --xui-blue-hover: #1a8cd8;
          --xui-black: #0f1419;
          --xui-gray: #536471;
          --xui-light-gray: #eff3f4;
          --xui-border: #cfd9de;
          --xui-card-bg: #f7f9f9;
        }
        [data-x-batch-profile-btn="true"] {
          cursor: pointer;
        }
        .x-batch-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -48%) scale(0.96);
          background: #ffffff;
          padding: 0;
          border-radius: 16px;
          border: 1px solid var(--xui-border);
          box-shadow: 0 10px 28px rgba(15, 20, 25, 0.16);
          z-index: 10001;
          width: 460px;
          max-width: calc(100vw - 24px);
          max-height: calc(100vh - 24px);
          overflow: hidden;
          color: var(--xui-black);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color-scheme: light;
          opacity: 0;
          transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2, 0.9, 0.2, 1);
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .x-batch-modal.x-batch-visible {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
        .x-batch-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15,20,25,0.45);
          backdrop-filter: blur(4px);
          z-index: 10000;
        }
        .x-batch-header {
          padding: 14px 16px;
          border-bottom: 1px solid var(--xui-light-gray);
          background: #fff;
        }
        .x-batch-headrow {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .x-batch-header-icon {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--xui-blue), #0d8bd9);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .x-batch-header-icon svg {
          width: 20px;
          height: 20px;
          fill: currentColor;
        }
        .x-batch-title { font-size: 24px; font-weight: 700; color: var(--xui-black); line-height: 1.1; }
        .x-batch-subtitle { font-size: 12px; color: var(--xui-gray); margin-top: 4px; }
        .x-batch-body { padding: 16px 16px 18px; }
        .x-batch-body {
          max-height: min(70vh, calc(100vh - 210px));
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .x-batch-modal::-webkit-scrollbar,
        .x-batch-body::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
        .x-batch-group {
          margin-bottom: 12px;
          background: var(--xui-card-bg);
          border-radius: 16px;
          padding: 12px;
          border: 1px solid var(--xui-light-gray);
        }
        .x-batch-label {
          display: block;
          font-weight: 700;
          margin-bottom: 8px;
          font-size: 12px;
          color: #32536f;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .x-batch-card { background: transparent; border: none; box-shadow: none; }
        .x-batch-row {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          padding: 0;
          border-bottom: none;
        }
        .x-batch-row:last-child { border-bottom: none; }
        .x-batch-row label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          font-weight: 600;
          color: #213547;
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 0;
        }
        .x-batch-input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #c8dff3;
          border-radius: 10px;
          font-size: 13px;
          color: #0f1419 !important;
          background: #ffffff !important;
          -webkit-text-fill-color: #0f1419 !important;
          appearance: none;
          -webkit-appearance: none;
          color-scheme: light;
        }
        .x-batch-select-wrap { position: relative; width: 100%; }
        .x-batch-select-trigger {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid #bfd8ee;
          border-radius: 12px;
          background: #fff;
          color: #0f1419;
          padding: 10px 12px;
          font-size: 13px;
          cursor: pointer;
        }
        .x-batch-select-trigger:hover { border-color: #91c3e8; }
        .x-batch-select-trigger:focus {
          outline: none;
          border-color: var(--xui-blue);
          box-shadow: 0 0 0 3px rgba(29,155,240,0.22);
        }
        .x-batch-select-caret {
          width: 12px;
          height: 12px;
          color: #617384;
          flex-shrink: 0;
          transition: transform 0.15s ease;
        }
        .x-batch-select-wrap.open .x-batch-select-caret { transform: rotate(180deg); }
        .x-batch-select-menu {
          position: absolute;
          left: 0;
          right: 0;
          top: calc(100% + 6px);
          background: #fff;
          border: 1px solid #bfd8ee;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(15,20,25,0.12);
          padding: 4px;
          display: none;
          z-index: 20;
        }
        .x-batch-select-wrap.open .x-batch-select-menu { display: block; }
        .x-batch-select-item {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          padding: 9px 10px;
          border-radius: 8px;
          color: #0f1419;
          font-size: 13px;
          cursor: pointer;
        }
        .x-batch-select-item:hover { background: #eff6fd; }
        .x-batch-select-item.active { background: #e8f3ff; color: #0b73ba; font-weight: 600; }
        input.x-batch-input,
        select.x-batch-input,
        input.x-batch-input[type="date"],
        input.x-batch-input[type="text"] {
          background-color: #ffffff !important;
          color: #0f1419 !important;
          border-color: #c8dff3 !important;
        }
        select.x-batch-input option {
          background: #ffffff !important;
          color: #0f1419 !important;
        }
        .x-batch-input:focus {
          outline: none;
          border-color: var(--xui-blue);
          box-shadow: 0 0 0 3px rgba(29,155,240,0.22);
        }
        .x-batch-inline { display: flex; gap: 10px; align-items: center; width: 100%; }
        .x-batch-inline > * { flex: 1; }
        .x-batch-checkbox { margin-right: 6px; }
        .x-batch-help { font-size: 12px; color: #597a96; margin-top: 6px; word-break: break-all; }
        .x-batch-status {
          margin-top: 14px;
          display: none;
          padding: 11px 12px;
          background: #eaf5ff;
          border: 1px solid #b8dfff;
          border-radius: 12px;
          font-size: 13px;
          color: #18507a;
          font-weight: 600;
        }
        .x-batch-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 16px;
        }
        .x-batch-btn-primary {
          background: linear-gradient(135deg, #1d9bf0 0%, #0d8bdd 100%);
          color: white;
          border: 1px solid #0f8de0;
          padding: 10px 17px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 700;
        }
        .x-batch-btn-primary:hover { background: linear-gradient(135deg, #1a8cd8 0%, #097fcd 100%); }
        .x-batch-btn-secondary {
          background: #fff;
          color: var(--xui-black);
          border: 1px solid #c8dff3;
          padding: 10px 17px;
          border-radius: 999px;
          cursor: pointer;
          font-weight: 700;
        }
        .x-batch-btn-secondary:hover { background: #f2f8fd; }
        .dark-mode .x-batch-modal { background: #000; color: #e7e9ea; border: 1px solid #2f3336; }
        .dark-mode .x-batch-header { background: #000; border-bottom-color: #2f3336; }
        .dark-mode .x-batch-title { color: #e7e9ea; }
        .dark-mode .x-batch-subtitle { color: #8899a6; }
        .dark-mode .x-batch-label, .dark-mode .x-batch-help { color: #8eb5d3; }
        .dark-mode .x-batch-group { background: #0f1419; border-color: #2f3336; }
        .dark-mode .x-batch-card { background: transparent; border-color: transparent; box-shadow: none; }
        .dark-mode .x-batch-row { border-bottom-color: #2f3336; }
        .dark-mode .x-batch-row label { background: #1b232a; border-color: #33414d; color: #dbe6ef; }
        .dark-mode .x-batch-input { background: #202327; border-color: #333639; color: white; }
        .dark-mode .x-batch-status { background: #0f2536; border-color: #1f415a; color: #9ad3ff; }
        .dark-mode .x-batch-btn-secondary { background: transparent; color: white; border-color: #536471; }
        .dark-mode .x-batch-btn-secondary:hover { background: rgba(255,255,255,0.08); }
      `;
      document.head.appendChild(style);
    },

    findProfileMoreButton() {
      const scopes = [];
      const userActions = document.querySelector('[data-testid="userActions"]');
      if (userActions) scopes.push(userActions);

      const classRow = document.querySelector('div.css-175oi2r.r-obd0qt.r-18u37iz.r-1w6e6rj.r-1h0z5md.r-dnmrzs');
      if (classRow) scopes.push(classRow);

      // 兜底：在主列中查找，避免误命中侧栏按钮
      const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
      if (primaryColumn) scopes.push(primaryColumn);

      const isMoreButton = (el) => {
        if (!el || el.getAttribute('data-x-batch-profile-btn') === 'true') return false;
        const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
        if (label.includes('more') || label.includes('更多')) return true;
        // X 常见的“更多”图标是三点
        const path = el.querySelector('svg path')?.getAttribute('d') || '';
        return path.includes('M3 12c0-1.1');
      };

      for (const scope of scopes) {
        const candidates = Array.from(scope.querySelectorAll('button,[role="button"]'));
        const moreButton = candidates.find(isMoreButton);
        if (moreButton) return moreButton;
      }

      return null;
    },

    getInsertAnchor(moreButton) {
      if (!moreButton) return null;
      const parent = moreButton.parentElement;
      if (!parent) return moreButton;

      // 结构通常是“外层容器 > button”，优先插在容器级别
      if (parent.children.length === 1) return parent;
      return moreButton;
    },

    checkPage() {
      // 简单判断是否在用户主页（包含 /username 且不包含 /status/）
      const path = window.location.pathname;
      const parts = path.split('/').filter(p => p);
      const isUserPage = parts.length > 0 &&
        !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(parts[0]) &&
        !path.includes('/status/');

      if (isUserPage) {
        this.state.userName = parts[0];
        if (!this.ui.btn || !this.ui.btn.isConnected) this.createButton();
      } else {
        if (this.ui.btn) {
          this.ui.btn.remove();
          this.ui.btn = null;
        }
      }
    },

    createButton() {
      if (this.ui.btn && this.ui.btn.isConnected) return;

      const moreButton = this.findProfileMoreButton();
      if (!moreButton || !moreButton.parentElement) return;

      const anchor = this.getInsertAnchor(moreButton);
      if (!anchor || !anchor.parentElement) return;

      const btn = anchor.cloneNode(true);
      btn.setAttribute('data-x-batch-profile-btn', 'true');
      const clickable = btn.matches('button,[role="button"]')
        ? btn
        : btn.querySelector('button,[role="button"]');
      if (!clickable) return;

      clickable.setAttribute('data-x-batch-profile-btn', 'true');
      clickable.setAttribute('aria-label', '\\u6279\\u91cf\\u4e0b\\u8f7d');
      clickable.setAttribute('title', '\\u6279\\u91cf\\u4e0b\\u8f7d');
      clickable.removeAttribute('data-testid');
      clickable.removeAttribute('aria-haspopup');
      clickable.removeAttribute('aria-expanded');

      const svg = clickable.querySelector('svg');
      if (svg) {
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.innerHTML = '<path d="M12 3v11.59l3.3-3.3 1.4 1.42L12 17.41l-4.7-4.7 1.4-1.42 3.3 3.3V3h2zm-7 14h14v2H5v-2z"/>';
      } else {
        clickable.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3v11.59l3.3-3.3 1.4 1.42L12 17.41l-4.7-4.7 1.4-1.42 3.3 3.3V3h2zm-7 14h14v2H5v-2z"/></svg>`;
      }

      clickable.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openModal();
      });

      anchor.parentElement.insertBefore(btn, anchor);
      this.ui.btn = btn;
    },

    openModal() {
      if (this.ui.modal) return;

      const overlay = document.createElement('div');
      overlay.className = 'x-batch-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) this.closeModal(); };

      const modal = document.createElement('div');
      modal.className = 'x-batch-modal';

      // 生成画质选项
      const qualityOptions = CONFIG.QUALITY_OPTIONS.map(o =>
        `<option value="${o.name}" ${o.name === this.config.quality ? 'selected' : ''}>${o.label}</option>`
      ).join('');

      modal.innerHTML = `
        <div class="x-batch-header">
          <div class="x-batch-headrow">
            <div class="x-batch-header-icon">
              <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </div>
            <div>
              <div class="x-batch-title">原图下载器</div>
              <div class="x-batch-subtitle">用户主页批量下载 · @${this.state.userName}</div>
            </div>
          </div>
        </div>
        <div class="x-batch-body">
          <div class="x-batch-group">
            <label class="x-batch-label">媒体类型</label>
            <div class="x-batch-card">
              <div class="x-batch-row">
                <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-img" ${this.config.types.image ? 'checked' : ''}>图片</label>
                <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-video" ${this.config.types.video ? 'checked' : ''}>视频</label>
                <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-gif" ${this.config.types.gif ? 'checked' : ''}>GIF</label>
              </div>
            </div>
          </div>

          <div class="x-batch-group">
            <label class="x-batch-label">图片质量</label>
            <div class="x-batch-card">
              <div class="x-batch-row">
                <input type="hidden" id="batch-quality" value="${this.config.quality}">
                <div class="x-batch-select-wrap" id="batch-quality-wrap">
                  <button type="button" class="x-batch-select-trigger" id="batch-quality-trigger" aria-haspopup="listbox" aria-expanded="false">
                    <span id="batch-quality-label">${CONFIG.QUALITY_OPTIONS.find(o => o.name === this.config.quality)?.label || this.config.quality}</span>
                    <svg class="x-batch-select-caret" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                  </button>
                  <div class="x-batch-select-menu" id="batch-quality-menu" role="listbox">
                    ${CONFIG.QUALITY_OPTIONS.map(o => `<button type="button" class="x-batch-select-item ${o.name === this.config.quality ? 'active' : ''}" data-value="${o.name}">${o.label}</button>`).join('')}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="x-batch-group">
            <label class="x-batch-label">时间范围（可选）</label>
            <div class="x-batch-card">
              <div class="x-batch-row x-batch-inline">
                <input type="date" class="x-batch-input" id="batch-date-start" value="${this.config.dateRange.start}">
                <input type="date" class="x-batch-input" id="batch-date-end" value="${this.config.dateRange.end}">
              </div>
            </div>
          </div>

          <div class="x-batch-group">
            <label class="x-batch-label">保存路径（相对下载目录）</label>
            <div class="x-batch-card">
              <div class="x-batch-row">
                <input type="text" class="x-batch-input" id="batch-path" value="${this.config.pathTemplate}">
              </div>
            </div>
            <div class="x-batch-help">支持变量: {date}, {time}, {id}, {user}</div>
          </div>

          <div class="x-batch-group">
            <label class="x-batch-label">文件名规则</label>
            <div class="x-batch-card">
              <div class="x-batch-row">
                <input type="text" class="x-batch-input" id="batch-name" value="${this.config.nameTemplate}">
              </div>
            </div>
            <div class="x-batch-help">示例: {date}_{id}</div>
          </div>

          <div class="x-batch-group">
            <label class="x-batch-label">模板预览</label>
            <div class="x-batch-card">
              <div class="x-batch-row">
                <div class="x-batch-help" id="batch-preview-text">下载后将显示在这里</div>
              </div>
            </div>
          </div>

          <div id="batch-status" class="x-batch-status">
            <div id="batch-status-text">正在扫描...</div>
          </div>

          <div class="x-batch-actions">
            <button class="x-batch-btn-secondary" id="batch-cancel">关闭</button>
            <button class="x-batch-btn-primary" id="batch-start">开始下载</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);
      requestAnimationFrame(() => modal.classList.add('x-batch-visible'));
      this.state.prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      this.ui.overlay = overlay;
      this.ui.modal = modal;

      // Bind events
      modal.querySelector('#batch-cancel').onclick = () => this.closeModal();
      modal.querySelector('#batch-start').onclick = () => this.toggleScan();
      this.setupQualitySelect(modal);
      this.bindTemplatePreview(modal);
      this.updateTemplatePreview(modal);
    },

    bindTemplatePreview(modal) {
      const pathInput = modal.querySelector('#batch-path');
      const nameInput = modal.querySelector('#batch-name');
      if (!pathInput || !nameInput) return;

      const updatePreview = () => this.updateTemplatePreview(modal);
      pathInput.addEventListener('input', updatePreview);
      nameInput.addEventListener('input', updatePreview);
    },

    updateTemplatePreview(modal) {
      const previewText = modal.querySelector('#batch-preview-text');
      const pathInput = modal.querySelector('#batch-path');
      const nameInput = modal.querySelector('#batch-name');
      if (!previewText || !pathInput || !nameInput) return;

      const previewConfig = normalizeBatchSettings({
        ...this.config,
        pathTemplate: pathInput.value,
        nameTemplate: nameInput.value
      }, this.config.quality);

      const sample = resolveBatchDownloadTarget({
        type: 'image',
        url: 'https://pbs.twimg.com/media/sample?format=png&name=4096x4096',
        tweetId: '1234567890',
        date: new Date('2026-03-25T12:34:56Z'),
        userName: this.state.userName || 'user'
      }, previewConfig, this.state.userName || 'user');

      previewText.textContent = `${sample.folder}/${sample.filename}`;
    },

    validateConfig(config) {
      if (!config.types.image && !config.types.video && !config.types.gif) {
        return '请至少选择一种媒体类型';
      }

      if (config.dateRange.start && config.dateRange.end && new Date(config.dateRange.start) > new Date(config.dateRange.end)) {
        return '开始日期不能晚于结束日期';
      }

      return null;
    },

    getUserNameFromItem(element) {
      return getItemUserName(element);
    },

    matchesDateRange(item, dateRange) {
      return matchesBatchDateRange(item, dateRange);
    },

    resolveDownloadTarget(item, config = this.config) {
      return resolveBatchDownloadTarget(item, config, item?.userName || this.state.userName || 'unknown');
    },

    setupQualitySelect(modal) {
      const wrap = modal.querySelector('#batch-quality-wrap');
      const trigger = modal.querySelector('#batch-quality-trigger');
      const menu = modal.querySelector('#batch-quality-menu');
      const hidden = modal.querySelector('#batch-quality');
      const label = modal.querySelector('#batch-quality-label');
      if (!wrap || !trigger || !menu || !hidden || !label) return;

      const open = () => {
        wrap.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      };
      const close = () => {
        wrap.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      };

      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (wrap.classList.contains('open')) close();
        else open();
      });

      menu.querySelectorAll('.x-batch-select-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          e.preventDefault();
          const value = item.getAttribute('data-value');
          hidden.value = value;
          label.textContent = item.textContent || value;
          menu.querySelectorAll('.x-batch-select-item').forEach((node) => node.classList.remove('active'));
          item.classList.add('active');
          close();
        });
      });

      this.ui.qualityOutsideHandler = (ev) => {
        if (!wrap.contains(ev.target)) close();
      };
      document.addEventListener('click', this.ui.qualityOutsideHandler, true);
    },

    closeModal() {
      if (this.state.scanning) {
        if (!confirm('正在下载中，确定要停止吗？')) return;
        this.state.stopping = true;
      }
      this.ui.modal?.remove();
      this.ui.overlay?.remove();
      this.ui.modal = null;
      this.ui.overlay = null;
      document.body.style.overflow = this.state.prevBodyOverflow || '';
      this.state.prevBodyOverflow = '';
      if (this.ui.qualityOutsideHandler) {
        document.removeEventListener('click', this.ui.qualityOutsideHandler, true);
        this.ui.qualityOutsideHandler = null;
      }
    },

    async toggleScan() {
      const btn = this.ui.modal.querySelector('#batch-start');
      const status = this.ui.modal.querySelector('#batch-status');

      if (this.state.scanning) {
        this.state.stopping = true;
        btn.textContent = '停止中...';
        return;
      }

      const nextConfig = normalizeBatchSettings({
        types: {
          image: this.ui.modal.querySelector('#batch-type-img').checked,
          video: this.ui.modal.querySelector('#batch-type-video').checked,
          gif: this.ui.modal.querySelector('#batch-type-gif').checked
        },
        quality: this.ui.modal.querySelector('#batch-quality').value,
        dateRange: {
          start: this.ui.modal.querySelector('#batch-date-start').value,
          end: this.ui.modal.querySelector('#batch-date-end').value
        },
        pathTemplate: this.ui.modal.querySelector('#batch-path').value,
        nameTemplate: this.ui.modal.querySelector('#batch-name').value
      }, userSettings.imageQuality);

      const validationError = this.validateConfig(nextConfig);
      if (validationError) {
        alert(validationError);
        return;
      }

      this.config = cloneBatchSettings(nextConfig);
      persistBatchSettings(this.config);
      this.updateTemplatePreview(this.ui.modal);

      this.state.scanning = true;
      this.state.stopping = false;
      this.state.scannedCount = 0;
      this.state.downloadCount = 0;
      this.state.mediaMap.clear();

      btn.textContent = '停止';
      status.style.display = 'block';

      await this.runScanLoop();

      this.state.scanning = false;
      if (this.ui.modal) {
        btn.textContent = '开始下载';
        this.ui.modal.querySelector('#batch-status-text').textContent =
          `完成！共扫描 ${this.state.scannedCount} 个，已加入下载队列 ${this.state.downloadCount} 个。`;
      }
    },

    async runScanLoop() {
      const statusText = this.ui.modal.querySelector('#batch-status-text');
      let noNewContentCount = 0;
      let lastHeight = 0;

      while (!this.state.stopping) {
        // Scrape
        const newItems = this.scrapeVisible();
        this.processItems(newItems);

        statusText.textContent = `正在扫描... 已找到: ${this.state.downloadCount} (扫描: ${this.state.scannedCount})`;

        // Check date stop
        if (this.shouldStopByDate()) {
          console.log('达到结束日期，停止扫描');
          break;
        }

        // Scroll
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 1200));

        const newHeight = document.body.scrollHeight;
        if (Math.abs(newHeight - lastHeight) < 50) {
          noNewContentCount++;
          if (noNewContentCount > 5) {
            console.log('到达页面底部');
            break;
          }
        } else {
          noNewContentCount = 0;
          lastHeight = newHeight;
        }
      }
    },

    scrapeVisible() {
      const items = [];
      const articles = document.querySelectorAll('article');
      articles.forEach(article => {
        // Extract Time
        const timeEl = article.querySelector('time');
        const dateStr = timeEl ? timeEl.getAttribute('datetime') : null;
        if (!dateStr) return;
        const date = new Date(dateStr);

        // Extract ID
        const tweetId = extractTweetId(article);

        // Images
        if (this.config.types.image) {
          article.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach(img => {
            const url = getImageUrl(img.src, this.config.quality);
            if (url) items.push({ type: 'image', url, date, tweetId, src: img.src });
          });
        }

        // Videos/GIFs
        article.querySelectorAll('video').forEach(video => {
          const isGif = isGifVideo(video);
          if (isGif && this.config.types.gif) {
            const url = getVideoPlaylistUrl(video);
            if (url) items.push({ type: 'gif', url, date, tweetId });
          } else if (!isGif && this.config.types.video) {
            if (tweetId) items.push({ type: 'video', tweetId, date });
          }
        });
      });
      return items;
    },

    processItems(items) {
      items.forEach(item => {
        this.state.scannedCount++;
        const key = item.url || (item.tweetId + item.type); // Unique key
        if (this.state.mediaMap.has(key)) return;
        if (!this.matchesDateRange(item, this.config.dateRange)) return;

        this.state.mediaMap.set(key, item);
        this.state.downloadCount++;

        // Trigger download immediately
        this.triggerDownload(item);
      });
    },

    shouldStopByDate() {
      if (!this.config.dateRange.start) return false;
      const articles = document.querySelectorAll('article');
      if (articles.length === 0) return false;
      const lastArticle = articles[articles.length - 1];
      const timeEl = lastArticle.querySelector('time');
      if (!timeEl) return false;
      const date = new Date(timeEl.getAttribute('datetime'));
      return date < new Date(this.config.dateRange.start);
    },

    triggerDownload(item, config = this.config) {
      const target = this.resolveDownloadTarget(item, config);

      if (item.type === 'image') {
        chrome.runtime.sendMessage({
          action: 'downloadImage',
          url: item.url,
          filename: target.filename,
          folder: target.folder,
          source: config === this.config ? 'batch' : 'quick-batch'
        });
      } else if (item.type === 'gif') {
        chrome.runtime.sendMessage({
          action: 'downloadVideo',
          directVideoUrl: item.url,
          tweetId: item.tweetId,
          pageUrl: window.location.href,
          isGif: true,
          filename: target.filename,
          folder: target.folder,
          source: config === this.config ? 'batch' : 'quick-batch'
        });
      } else if (item.type === 'video') {
        chrome.runtime.sendMessage({
          action: 'downloadVideo',
          tweetId: item.tweetId,
          pageUrl: window.location.href,
          isGif: false,
          filename: target.filename,
          folder: target.folder,
          source: config === this.config ? 'batch' : 'quick-batch'
        });
      }
    },

    formatFilename(item) {
      return this.resolveDownloadTarget(item).baseName;
    }
  };

  /**
   * 初始化
   */
  function init() {
    console.log('[X下载器] 扩展已加载 v1.0');

    loadSettings();

    createPreviewElement();
    setTimeout(scanMedia, 500);
    initObserver();
    initGlobalListeners();
    setInterval(scanMedia, 2000);

    // 初始化批量下载器
    BatchDownloader.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

