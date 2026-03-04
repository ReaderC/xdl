// X/Twitter 原图下载器 - 内容脚本
(function () {
  'use strict';

  // 默认设置
  let userSettings = {
    imageQuality: '4096x4096',
    enablePreview: true,
    previewShortcut: 'none',
    previewDelay: 300,
    previewTriggerMode: 'auto',  // 'auto' = 自动显示, 'key' = 按键触发
    previewTriggerKey: 'shift',  // shift, alt, ctrl
    previewFollowMouse: true     // 预览窗口始终跟随鼠标移动
  };

  // 加载用户设置
  function loadSettings() {
    chrome.storage.sync.get({
      imageQuality: '4096x4096',
      enablePreview: true,
      previewShortcut: 'none',
      previewDelay: 300,
      previewTriggerMode: 'auto',
      previewTriggerKey: 'shift',
      previewFollowMouse: true
    }, (items) => {
      userSettings = items;
      userSettings.previewFollowMouse = true; // 始终强制跟随鼠标
      CONFIG.PREVIEW_DELAY = userSettings.previewDelay;
    });
  }

  // 监听设置更新消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsUpdated') {
      userSettings = message.settings;
      userSettings.previewFollowMouse = true; // 始终强制跟随鼠标
      CONFIG.PREVIEW_DELAY = userSettings.previewDelay;
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
    PROCESSED_ATTR: 'data-x-downloader-processed'
  };

  // 辅助函数获取用户设置
  function getEnablePreview() { return userSettings.enablePreview; }
  function getImageQuality() { return userSettings.imageQuality; }
  function getPreviewFollowMouse() { return true; } // 始终跟随鼠标

  // 检查是否满足触发预览的条件（按键模式）
  function checkTriggerCondition(event) {
    if (userSettings.previewTriggerMode !== 'key') return true;

    const key = userSettings.previewTriggerKey;
    if (key === 'shift') return event.shiftKey;
    if (key === 'alt') return event.altKey;
    if (key === 'ctrl') return event.ctrlKey;
    return true;
  }

  // 预览相关
  let previewElement = null;
  let previewTimeout = null;
  let currentPreviewUrl = null;
  let currentPreviewImg = null;
  let currentPreviewGif = null;
  let previewScale = 1;
  let isPreviewVisible = false;
  let basePreviewWidth = 0;
  let basePreviewHeight = 0;
  let previewHideTimer = null;
  let activePreviewTarget = null; // 当前预览的目标元素
  let previewFollowMouseHandler = null; // 跟随鼠标移动的事件处理器
  let isTransitioningToPreview = false; // 是否正在从图片过渡到预览窗口
  let isPreviewPinned = false; // 预览窗口是否被固定（跟随鼠标模式下按空格键固定）
  let isInImageViewer = false; // 是否在X的大图查看器中
  let currentImageList = []; // 当前推文中的图片列表
  let currentImageIndex = 0; // 当前预览图片在列表中的索引

  // 拖动相关
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let previewStartX = 0;
  let previewStartY = 0;

  /**
   * 获取图片URL
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
   * 获取预览URL
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
   * 提取推文ID
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

  /**
   * 获取当前推文中的所有图片
   * @param {Element} element 起始元素
   * @returns {Array} 图片URL数组
   */
  function getTweetImages(element) {
    const images = [];

    // 找到包含图片的容器（推文）
    const article = element?.closest('article') || document.querySelector('article');
    if (!article) return images;

    // 查找所有图片
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
   * 切换到上一张/下一张图片
   * @param {number} direction -1 上一张, 1 下一张
   */
  function switchImage(direction) {
    if (currentImageList.length <= 1) return;

    const newIndex = currentImageIndex + direction;
    if (newIndex < 0 || newIndex >= currentImageList.length) return;

    currentImageIndex = newIndex;
    const newUrl = currentImageList[currentImageIndex];

    // 更新预览
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
   * 显示/隐藏操作按钮（跟随鼠标模式）
   */
  function toggleFollowModeActions(show) {
    if (!previewElement || !getPreviewFollowMouse()) return;

    const actions = previewElement.querySelector('.x-preview-actions-follow');
    if (actions) {
      actions.style.display = show ? 'flex' : 'none';
    }
  }

  /**
   * 获取视频URL
   * @param {HTMLVideoElement} videoElement 视频元素
   * @param {boolean} allowBlob 是否允许返回blob URL（用于GIF预览）
   */
  function getVideoPlaylistUrl(videoElement, allowBlob = false) {
    // 首先检查video元素的src
    if (videoElement.src && videoElement.src.includes('video.twimg.com')) {
      if (!videoElement.src.startsWith('blob:') || allowBlob) {
        return videoElement.src;
      }
    }

    // 检查source元素
    const sources = videoElement.querySelectorAll('source');
    for (const source of sources) {
      if (source.src && source.src.includes('video.twimg.com')) {
        if (!source.src.startsWith('blob:') || allowBlob) {
          return source.src;
        }
      }
    }

    // 对于GIF预览，尝试使用blob URL
    if (allowBlob && videoElement.src && videoElement.src.startsWith('blob:')) {
      return videoElement.src;
    }

    return null;
  }

  /**
   * 检查是否是GIF
   */
  function isGifVideo(videoElement) {
    const hasLoop = videoElement.loop;
    const hasMuted = videoElement.muted;
    const container = videoElement.closest('[data-testid="tweetPhoto"]');

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
        downloadImage(imageUrl, '4096x4096');
      });
    } else if ((isGif || isVideo) && videoElement) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleVideoDownload(videoElement, btn, isGif);
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
        downloadImage(imageUrl, option.name);
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
  function downloadImage(imageUrl, quality) {
    if (!quality) {
      quality = getImageQuality();
    }
    const downloadUrl = getImageUrl(imageUrl, quality);
    if (downloadUrl) {
      chrome.runtime.sendMessage({
        action: 'downloadImage',
        url: downloadUrl,
        filename: getFileName(imageUrl, quality)
      }, (response) => {
        showNotification(response?.success ? `开始下载 ${quality} 画质图片...` : '下载失败', response?.success ? 'success' : 'error');
      });
    }
  }

  /**
   * 处理视频下载
   */
  function handleVideoDownload(videoElement, btn, isGif = false) {
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" class="x-loading-spinner"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>`;

    const tweetId = extractTweetId(videoElement);
    const directVideoUrl = getVideoPlaylistUrl(videoElement);

    console.log('[X下载器] 请求:', { tweetId, directVideoUrl, isGif });

    chrome.runtime.sendMessage({
      action: 'downloadVideo',
      tweetId: tweetId,
      directVideoUrl: directVideoUrl,
      pageUrl: window.location.href,
      isGif: isGif
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

    // 根据跟随鼠标模式决定HTML结构
    if (isFollowMode) {
      previewElement.innerHTML = `
        <div class="x-preview-content x-preview-follow-mode">
          <img class="x-preview-image" src="" alt="预览" draggable="false">
          <video class="x-preview-gif" src="" autoplay loop muted playsinline style="display:none;"></video>
          <div class="x-preview-loading"><div class="x-preview-spinner"></div><span>加载中...</span></div>
          <div class="x-preview-scale-info" style="display:none;">100%</div>
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

    // 跟随鼠标模式：初始设置pointer-events为none
    if (isFollowMode) {
      previewElement.style.pointerEvents = 'none';

      // 跟随鼠标模式下添加滚轮缩放支持
      // 固定后不需要Alt，未固定需要Alt
      previewElement.addEventListener('wheel', (e) => {
        if (!isPreviewVisible) return;
        // 固定状态下直接缩放，未固定需要Alt
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

      // 跟随鼠标模式下添加拖动支持（固定状态下）
      previewElement.addEventListener('mousedown', (e) => {
        if (!isPreviewPinned || !isPreviewVisible) return;

        // 如果点击的是按钮，不触发拖动
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
            downloadImage(currentPreviewImg, '4096x4096');
          }
        });
      }

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

    // 鼠标离开时隐藏（如果正在过渡则忽略）
    previewElement.addEventListener('mouseleave', (e) => {
      // 如果正在从图片过渡到预览窗口，忽略mouseleave事件
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
          if (currentPreviewImg) downloadImage(currentPreviewImg, option.name);
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
      if (currentPreviewImg) downloadImage(currentPreviewImg, '4096x4096');
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
    loading.style.display = 'flex';
    content.style.cursor = 'grab';

    previewScale = 1;

    if (isGif && gifUrl) {
      currentPreviewImg = null;
      currentPreviewGif = gifUrl;

      previewGif.onload = () => {
        loading.style.display = 'none';
        previewGif.style.display = 'block';
        positionPreview(preview, previewGif, x, y);
      };
      previewGif.onerror = () => { loading.innerHTML = '<span>加载失败</span>'; };
      previewGif.src = gifUrl;
    } else {
      currentPreviewImg = imageUrl;
      currentPreviewGif = null;

      const previewUrl = getPreviewUrl(imageUrl) || imageUrl;

      previewImg.onload = () => {
        loading.style.display = 'none';
        previewImg.style.display = 'block';
        positionPreview(preview, previewImg, x, y);
      };
      previewImg.onerror = () => { loading.innerHTML = '<span>加载失败</span>'; };
      previewImg.src = previewUrl;
    }

    // 立即显示，无需动画
    preview.classList.add('x-preview-visible');
    isPreviewVisible = true;
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

    // 跟随鼠标模式：最大化预览窗口，上下顶到浏览器边缘
    const margin = 10; // 上下留10px边距
    const maxHeight = viewport.height - margin * 2;
    const maxWidth = isFollowMode ? Math.min(viewport.width * 0.7, 900) : Math.min(viewport.width * 0.7, 800);

    let displayWidth = naturalWidth;
    let displayHeight = naturalHeight;
    const aspectRatio = naturalWidth / naturalHeight;

    // 先按高度最大化
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

    // 跟随鼠标模式：预览窗口在鼠标右侧，垂直居中
    let left, top;
    if (isFollowMode) {
      left = x + 20;
      top = margin; // 顶部对齐边距
    } else {
      left = x + 25;
      top = y - displayHeight / 2;
    }

    if (left + displayWidth > viewport.width - margin) left = x - displayWidth - 20;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    if (top + displayHeight > viewport.height - margin) top = viewport.height - displayHeight - margin;

    const content = preview.querySelector('.x-preview-content');
    content.style.width = `${displayWidth}px`;
    content.style.height = `${displayHeight}px`;
    preview.style.left = `${left}px`;
    preview.style.top = `${top}px`;
  }

  /**
   * 隐藏预览
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
      // 重置pointer-events为none（跟随鼠标模式）
      if (getPreviewFollowMouse()) {
        previewElement.style.pointerEvents = 'none';
        // 隐藏操作按钮
        toggleFollowModeActions(false);
      }
      const previewGif = previewElement.querySelector('.x-preview-gif');
      previewGif.pause();
      previewGif.src = '';
    }
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

  function isProcessed(container) {
    return container.hasAttribute(CONFIG.PROCESSED_ATTR);
  }

  function markProcessed(container) {
    container.setAttribute(CONFIG.PROCESSED_ATTR, 'true');
  }

  /**
   * 处理图片容器
   */
  function processImageContainer(container) {
    const img = container.querySelector('img[src*="pbs.twimg.com/media"]');
    if (!img || isProcessed(container)) return;

    const imageUrl = img.src;
    if (!imageUrl) return;

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const btn = createDownloadButton(imageUrl);
    container.appendChild(btn);

    markProcessed(container);
    setupImagePreview(img, container);
  }

  /**
   * 设置图片预览 - 即时切换版本
   */
  function setupImagePreview(img, container) {
    if (!getEnablePreview()) return;

    // 跟随鼠标模式的鼠标移动处理器
    let mouseMoveHandler = null;

    container.addEventListener('mouseenter', (e) => {
      // 检查触发条件
      if (!checkTriggerCondition(e)) return;

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
          // 再次检查是否在大图查看器中
          if (isInImageViewer) return;

          showPreview(img.src, e.clientX, e.clientY);

          // 跟随鼠标模式：添加鼠标移动监听器
          if (getPreviewFollowMouse() && previewElement) {
            mouseMoveHandler = (moveEvent) => {
              if (previewElement && isPreviewVisible) {
                // 如果预览窗口被固定，不更新位置
                if (isPreviewPinned) return;

                const viewport = { width: window.innerWidth, height: window.innerHeight };
                let left = moveEvent.clientX + 20;
                let top = moveEvent.clientY + 20;

                // 边界检查
                if (left + basePreviewWidth * previewScale > viewport.width - 20) {
                  left = moveEvent.clientX - basePreviewWidth * previewScale - 20;
                }
                if (top + basePreviewHeight * previewScale > viewport.height - 20) {
                  top = moveEvent.clientY - basePreviewHeight * previewScale - 20;
                }
                if (left < 20) left = 20;
                if (top < 20) top = 20;

                previewElement.style.left = `${left}px`;
                previewElement.style.top = `${top}px`;
              }
            };
            document.addEventListener('mousemove', mouseMoveHandler);
          }
        }, CONFIG.PREVIEW_DELAY);
      }
    });


    container.addEventListener('mouseleave', () => {
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
    if (isProcessed(container)) return;

    const video = videoElement || container.querySelector('video');
    if (!video) return;

    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const isGif = forcedIsGif !== null ? forcedIsGif : isGifVideo(video);
    const btn = createDownloadButton(null, !isGif, video, isGif);
    container.appendChild(btn);

    markProcessed(container);

    if (isGif) {
      setupGifPreview(video, container);
    }
  }

  /**
   * 设置GIF预览 - 即时切换版本
   */
  function setupGifPreview(video, container) {
    // 跟随鼠标模式的鼠标移动处理器
    let mouseMoveHandler = null;

    container.addEventListener('mouseenter', (e) => {
      if (!checkTriggerCondition(e)) return;

      // 如果在大图查看器中，不显示预览
      if (isInImageViewer) return;

      cancelHidePreview();
      activePreviewTarget = container;

      // 对于GIF预览，允许使用blob URL
      const videoUrl = getVideoPlaylistUrl(video, true);
      if (!videoUrl) return;

      if (isPreviewVisible) {
        updatePreviewContent(null, e.clientX, e.clientY, true, videoUrl);
        return;
      }

      if (!isPreviewVisible) {
        previewTimeout = setTimeout(() => {
          // 再次检查是否在大图查看器中
          if (isInImageViewer) return;

          showPreview(null, e.clientX, e.clientY, true, videoUrl);

          // 跟随鼠标模式：添加鼠标移动监听器
          if (getPreviewFollowMouse() && previewElement) {
            mouseMoveHandler = (moveEvent) => {
              if (previewElement && isPreviewVisible) {
                // 如果预览窗口被固定，不更新位置
                if (isPreviewPinned) return;

                const viewport = { width: window.innerWidth, height: window.innerHeight };
                let left = moveEvent.clientX + 20;
                let top = moveEvent.clientY + 20;

                // 边界检查
                if (left + basePreviewWidth * previewScale > viewport.width - 20) {
                  left = moveEvent.clientX - basePreviewWidth * previewScale - 20;
                }
                if (top + basePreviewHeight * previewScale > viewport.height - 20) {
                  top = moveEvent.clientY - basePreviewHeight * previewScale - 20;
                }
                if (left < 20) left = 20;
                if (top < 20) top = 20;

                previewElement.style.left = `${left}px`;
                previewElement.style.top = `${top}px`;
              }
            };
            document.addEventListener('mousemove', mouseMoveHandler);
          }
        }, CONFIG.PREVIEW_DELAY);
      }
    });


    container.addEventListener('mouseleave', () => {
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
                isGif: isGif
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

    if (container && !isProcessed(container)) {
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

    if (container && !isProcessed(container)) {
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
   * 批量下载处理
   */
  function handleBatchDownload(filters) {
    const { mediaTypes, quality, dateRange } = filters;
    const results = [];

    // 扫描所有媒体
    const images = document.querySelectorAll('img[src*="pbs.twimg.com/media"]');
    const videos = document.querySelectorAll('video');

    images.forEach((img, index) => {
      if (mediaTypes.includes('image') && img.src.includes('pbs.twimg.com/media')) {
        const url = getImageUrl(img.src, quality) || img.src;
        results.push({
          type: 'image',
          url: url,
          filename: getFileName(img.src, quality)
        });
      }
    });

    videos.forEach((video) => {
      const isGif = isGifVideo(video);
      if (isGif && mediaTypes.includes('gif')) {
        const videoUrl = getVideoPlaylistUrl(video);
        if (videoUrl) {
          results.push({
            type: 'gif',
            url: videoUrl,
            filename: `gif_${Date.now()}.mp4`
          });
        }
      } else if (!isGif && mediaTypes.includes('video')) {
        const tweetId = extractTweetId(video);
        if (tweetId) {
          results.push({
            type: 'video',
            tweetId: tweetId,
            filename: `video_${tweetId}.mp4`
          });
        }
      }
    });

    // 发送下载任务
    let completed = 0;
    const total = results.length;

    if (total === 0) {
      showNotification('未找到符合条件的媒体', 'error');
      return;
    }

    showNotification(`开始批量下载 ${total} 个文件...`, 'success');

    results.forEach((item, index) => {
      setTimeout(() => {
        if (item.type === 'image' || item.type === 'gif') {
          chrome.runtime.sendMessage({
            action: 'downloadImage',
            url: item.url,
            filename: item.filename
          });
        } else if (item.type === 'video') {
          chrome.runtime.sendMessage({
            action: 'downloadVideo',
            tweetId: item.tweetId,
            pageUrl: window.location.href,
            isGif: false
          });
        }

        completed++;
        if (completed === total) {
          showNotification(`批量下载完成！共 ${total} 个文件`, 'success');
        }
      }, index * 500); // 500ms间隔避免限流
    });
  }

  /**
   * 初始化Observer
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
        // ESC键也取消固定状态
        if (isPreviewPinned) {
          isPreviewPinned = false;
          // 恢复pointer-events为none
          if (previewElement && getPreviewFollowMouse()) {
            previewElement.style.pointerEvents = 'none';
            // 隐藏操作按钮
            toggleFollowModeActions(false);
          }
          updatePreviewHint();
        }
      }

      // 左右方向键：切换图片（跟随鼠标模式固定状态下）
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

      // 空格键：固定/恢复预览窗口（仅在跟随鼠标模式下）
      // 使用 e.code 来检测空格键，更可靠
      if (e.code === 'Space') {
        const followMouse = getPreviewFollowMouse();
        console.log('[X下载器] 空格键按下, 跟随鼠标模式:', followMouse, '预览可见:', isPreviewVisible);

        if (followMouse && isPreviewVisible) {
          // 阻止默认行为（如页面滚动）
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          isPreviewPinned = !isPreviewPinned;

          // 固定时启用pointer-events，允许拖动和滚轮缩放
          if (previewElement) {
            previewElement.style.pointerEvents = isPreviewPinned ? 'auto' : 'none';

            // 固定时设置cursor为grab
            const content = previewElement.querySelector('.x-preview-content');
            if (content) {
              content.style.cursor = isPreviewPinned ? 'grab' : 'default';
            }

            // 显示/隐藏操作按钮
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
    // 固定状态：直接滚轮缩放；未固定：需要Alt
    document.addEventListener('wheel', (e) => {
      if (!isPreviewVisible || !getPreviewFollowMouse()) return;

      // 固定状态下直接缩放，未固定需要Alt
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

    // 全局鼠标移动事件：处理拖动（跟随鼠标模式固定状态下）
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
    // X/Twitter的大图查看器特征：
    // 1. URL变为 /photo/1 或类似格式
    // 2. 页面上出现 [data-testid="tweetPhoto"] 的放大版本
    // 3. 出现遮罩层

    const checkImageViewer = () => {
      // 检查URL是否包含 /photo/
      const isPhotoUrl = window.location.href.includes('/photo/');

      // 检查是否存在大图查看器的遮罩层或容器
      const hasImageViewerModal = document.querySelector('[data-testid="swipe-to-dismiss"]') ||
        document.querySelector('[data-testid="image-viewer"]') ||
        document.querySelector('[aria-label*="关闭"]')?.closest('[role="dialog"]');

      const wasInImageViewer = isInImageViewer;
      isInImageViewer = isPhotoUrl || !!hasImageViewerModal;

      // 如果刚进入大图查看器，隐藏预览窗口
      if (!wasInImageViewer && isInImageViewer) {
        hidePreview(0);
        isPreviewPinned = false;
      }
    };

    // 监听URL变化（SPA路由，包括返回上一页）
    let lastUrl = window.location.href;
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        // URL变化时，先关闭预览窗口（防止返回上一页后预览残留）
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

    // 监听DOM变化检测模态框
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
      mediaMap: new Map() // url -> {filename, type, tweetId}
    },

    config: {
      types: { image: true, video: true, gif: true },
      quality: '4096x4096',
      dateRange: { start: '', end: '' },
      pathTemplate: 'X_Downloads/{user}',
      nameTemplate: '{date}_{id}'
    },

    ui: {
      btn: null,
      modal: null,
      overlay: null
    },

    init() {
      this.injectStyles();
      // 监听URL变化，判断是否显示按钮
      setInterval(() => this.checkPage(), 1000);
    },

    injectStyles() {
      if (document.getElementById('x-batch-style')) return;
      const style = document.createElement('style');
      style.id = 'x-batch-style';
      style.textContent = `
        .x-batch-btn {
          position: fixed;
          bottom: 80px;
          right: 30px;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background-color: #1d9bf0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          z-index: 9999;
          transition: transform 0.2s;
          color: white;
        }
        .x-batch-btn:hover { transform: scale(1.05); background-color: #1a8cd8; }
        .x-batch-modal {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #fff;
          padding: 24px;
          border-radius: 16px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          z-index: 10001;
          width: 400px;
          color: #0f1419;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .x-batch-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 10000;
        }
        .x-batch-title { font-size: 20px; font-weight: bold; margin-bottom: 20px; }
        .x-batch-group { margin-bottom: 16px; }
        .x-batch-label { display: block; font-weight: 600; margin-bottom: 8px; font-size: 14px; }
        .x-batch-row { display: flex; gap: 12px; align-items: center; }
        .x-batch-input { width: 100%; padding: 8px 12px; border: 1px solid #cfd9de; border-radius: 4px; font-size: 14px; }
        .x-batch-checkbox { margin-right: 8px; }
        .x-batch-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
        .x-batch-btn-primary { background: #0f1419; color: white; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: bold; }
        .x-batch-btn-secondary { background: white; color: #0f1419; border: 1px solid #cfd9de; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: bold; }
        .dark-mode .x-batch-modal { background: #000; color: #e7e9ea; border: 1px solid #2f3336; }
        .dark-mode .x-batch-input { background: #202327; border-color: #333639; color: white; }
        .dark-mode .x-batch-btn-secondary { background: transparent; color: white; border-color: #536471; }
      `;
      document.head.appendChild(style);
    },

    checkPage() {
      // 简单判断是否在用户主页 (包含 /username 且不包含 /status/)
      const path = window.location.pathname;
      const parts = path.split('/').filter(p => p);
      const isUserPage = parts.length > 0 &&
        !['home', 'explore', 'notifications', 'messages', 'search', 'settings'].includes(parts[0]) &&
        !path.includes('/status/');

      if (isUserPage) {
        this.state.userName = parts[0];
        if (!this.ui.btn) this.createButton();
      } else {
        if (this.ui.btn) {
          this.ui.btn.remove();
          this.ui.btn = null;
        }
      }
    },

    createButton() {
      const btn = document.createElement('div');
      btn.className = 'x-batch-btn';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
      btn.title = '批量下载';
      btn.onclick = () => this.openModal();
      document.body.appendChild(btn);
      this.ui.btn = btn;
    },

    openModal() {
      if (this.ui.modal) return;

      const isDark = document.body.style.backgroundColor === 'rgb(0, 0, 0)' || document.body.style.backgroundColor === '#000000';

      const overlay = document.createElement('div');
      overlay.className = 'x-batch-overlay';
      overlay.onclick = (e) => { if (e.target === overlay) this.closeModal(); };

      const modal = document.createElement('div');
      modal.className = `x-batch-modal ${isDark ? 'dark-mode' : ''}`;

      // 生成画质选项
      const qualityOptions = CONFIG.QUALITY_OPTIONS.map(o =>
        `<option value="${o.name}" ${o.name === this.config.quality ? 'selected' : ''}>${o.label}</option>`
      ).join('');

      modal.innerHTML = `
        <div class="x-batch-title">批量下载 @${this.state.userName}</div>

        <div class="x-batch-group">
          <label class="x-batch-label">媒体类型</label>
          <div class="x-batch-row">
            <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-img" ${this.config.types.image ? 'checked' : ''}>图片</label>
            <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-video" ${this.config.types.video ? 'checked' : ''}>视频</label>
            <label><input type="checkbox" class="x-batch-checkbox" id="batch-type-gif" ${this.config.types.gif ? 'checked' : ''}>GIF</label>
          </div>
        </div>

        <div class="x-batch-group">
          <label class="x-batch-label">图片画质</label>
          <select class="x-batch-input" id="batch-quality">
            ${qualityOptions}
          </select>
        </div>

        <div class="x-batch-group">
          <label class="x-batch-label">时间范围 (可选)</label>
          <div class="x-batch-row">
            <input type="date" class="x-batch-input" id="batch-date-start" placeholder="开始" value="${this.config.dateRange.start}">
            <span>-</span>
            <input type="date" class="x-batch-input" id="batch-date-end" placeholder="结束" value="${this.config.dateRange.end}">
          </div>
        </div>

        <div class="x-batch-group">
          <label class="x-batch-label">保存路径 (相对下载目录)</label>
          <input type="text" class="x-batch-input" id="batch-path" value="${this.config.pathTemplate}">
        </div>

        <div class="x-batch-group">
          <label class="x-batch-label">文件名规则</label>
          <input type="text" class="x-batch-input" id="batch-name" value="${this.config.nameTemplate}">
          <div style="font-size:12px;color:#888;margin-top:4px">支持变量: {date}, {time}, {id}, {user}</div>
        </div>

        <div id="batch-status" style="margin-top:16px;display:none;padding:10px;background:rgba(29,155,240,0.1);border-radius:8px;">
          <div id="batch-status-text">正在扫描...</div>
        </div>

        <div class="x-batch-actions">
          <button class="x-batch-btn-secondary" id="batch-cancel">关闭</button>
          <button class="x-batch-btn-primary" id="batch-start">开始下载</button>
        </div>
      `;

      document.body.appendChild(overlay);
      document.body.appendChild(modal);

      this.ui.overlay = overlay;
      this.ui.modal = modal;

      // Bind events
      modal.querySelector('#batch-cancel').onclick = () => this.closeModal();
      modal.querySelector('#batch-start').onclick = () => this.toggleScan();
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
    },

    async toggleScan() {
      const btn = this.ui.modal.querySelector('#batch-start');
      const status = this.ui.modal.querySelector('#batch-status');

      if (this.state.scanning) {
        this.state.stopping = true;
        btn.textContent = '停止中...';
        return;
      }

      // Read config
      this.config.types.image = this.ui.modal.querySelector('#batch-type-img').checked;
      this.config.types.video = this.ui.modal.querySelector('#batch-type-video').checked;
      this.config.types.gif = this.ui.modal.querySelector('#batch-type-gif').checked;
      this.config.quality = this.ui.modal.querySelector('#batch-quality').value;
      this.config.dateRange.start = this.ui.modal.querySelector('#batch-date-start').value;
      this.config.dateRange.end = this.ui.modal.querySelector('#batch-date-end').value;
      this.config.pathTemplate = this.ui.modal.querySelector('#batch-path').value;
      this.config.nameTemplate = this.ui.modal.querySelector('#batch-name').value;

      if (!this.config.types.image && !this.config.types.video && !this.config.types.gif) {
        alert('请至少选择一种媒体类型');
        return;
      }

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

        // Date Filter
        if (this.config.dateRange.start) {
          const startDate = new Date(this.config.dateRange.start);
          if (item.date < startDate) return; // Skip logic handled in loop, but double check here
        }
        if (this.config.dateRange.end) {
          const endDate = new Date(this.config.dateRange.end);
          endDate.setHours(23, 59, 59);
          if (item.date > endDate) return;
        }

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

    triggerDownload(item) {
      const filename = this.formatFilename(item);
      const folder = this.config.pathTemplate.replace('{user}', this.state.userName);

      if (item.type === 'image') {
        chrome.runtime.sendMessage({
          action: 'downloadImage',
          url: item.url,
          filename: filename + (item.url.includes('format=png') ? '.png' : '.jpg'),
          folder: folder
        });
      } else if (item.type === 'gif') {
        chrome.runtime.sendMessage({
          action: 'downloadVideo',
          directVideoUrl: item.url,
          tweetId: item.tweetId,
          isGif: true,
          folder: folder
        });
      } else if (item.type === 'video') {
        chrome.runtime.sendMessage({
          action: 'downloadVideo',
          tweetId: item.tweetId,
          isGif: false,
          folder: folder
        });
      }
    },

    formatFilename(item) {
      const yyyy = item.date.getFullYear();
      const mm = String(item.date.getMonth() + 1).padStart(2, '0');
      const dd = String(item.date.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}${mm}${dd}`;
      const timeStr = item.date.toTimeString().split(' ')[0].replace(/:/g, '');

      let name = this.config.nameTemplate;
      name = name.replace('{date}', dateStr);
      name = name.replace('{time}', timeStr);
      name = name.replace('{id}', item.tweetId || 'unknown');
      name = name.replace('{user}', this.state.userName);
      return name;
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
