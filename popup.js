// X/Twitter 原图下载器 - Popup脚本 (设置页面)

document.addEventListener('DOMContentLoaded', function () {
  // 获取DOM元素
  const enablePreview = document.getElementById('enablePreview');
  const enableImagePreview = document.getElementById('enableImagePreview');
  const enableGifPreview = document.getElementById('enableGifPreview');
  const previewTriggerMode = document.getElementById('previewTriggerMode');
  const previewTriggerKey = document.getElementById('previewTriggerKey');
  const triggerKeyItem = document.getElementById('triggerKeyItem');
  const previewDelay = document.getElementById('previewDelay');
  const previewDelayValue = document.getElementById('previewDelayValue');
  const imageQuality = document.getElementById('imageQuality');
  const batchImage = document.getElementById('batchImage');
  const batchVideo = document.getElementById('batchVideo');
  const batchGif = document.getElementById('batchGif');
  const batchQuality = document.getElementById('batchQuality');
  const batchDateStart = document.getElementById('batchDateStart');
  const batchDateEnd = document.getElementById('batchDateEnd');
  const batchPathTemplate = document.getElementById('batchPathTemplate');
  const batchNameTemplate = document.getElementById('batchNameTemplate');
  const batchTemplatePreview = document.getElementById('batchTemplatePreview');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusMessage = document.getElementById('statusMessage');
  const statusText = document.getElementById('statusText');
  const downloadStatusResolving = document.getElementById('downloadStatusResolving');
  const downloadStatusDownloading = document.getElementById('downloadStatusDownloading');
  const downloadStatusCompleted = document.getElementById('downloadStatusCompleted');
  const downloadStatusFailed = document.getElementById('downloadStatusFailed');
  const downloadStatusTotal = document.getElementById('downloadStatusTotal');
  const downloadStatusUpdated = document.getElementById('downloadStatusUpdated');
  const downloadStatusList = document.getElementById('downloadStatusList');

  function getDefaultBatchSettings() {
    return {
      types: { image: true, video: true, gif: true },
      quality: '4096x4096',
      dateRange: { start: '', end: '' },
      pathTemplate: 'X_Downloads/{user}',
      nameTemplate: '{date}_{id}'
    };
  }

  function sanitizeTemplateValue(value, fallbackValue) {
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
      quality: sanitizeTemplateValue(raw.quality, fallbackQuality || defaults.quality),
      dateRange: {
        start: typeof raw.dateRange?.start === 'string' ? raw.dateRange.start : defaults.dateRange.start,
        end: typeof raw.dateRange?.end === 'string' ? raw.dateRange.end : defaults.dateRange.end
      },
      pathTemplate: sanitizeTemplateValue(raw.pathTemplate, defaults.pathTemplate),
      nameTemplate: sanitizeTemplateValue(raw.nameTemplate, defaults.nameTemplate)
    };
  }

  function validateBatchSettings(batchSettings) {
    if (!batchSettings.types.image && !batchSettings.types.video && !batchSettings.types.gif) {
      return '请至少选择一种媒体类型';
    }

    if (batchSettings.dateRange.start && batchSettings.dateRange.end && new Date(batchSettings.dateRange.start) > new Date(batchSettings.dateRange.end)) {
      return '开始日期不能晚于结束日期';
    }

    return null;
  }

  function renderBatchTemplatePreview(batchSettings) {
    const tokens = {
      date: '20260325',
      time: '123456',
      id: '1234567890',
      user: 'user'
    };

    const path = batchSettings.pathTemplate.replace(/\{(date|time|id|user)\}/g, (_, token) => tokens[token] || 'unknown');
    const name = batchSettings.nameTemplate.replace(/\{(date|time|id|user)\}/g, (_, token) => tokens[token] || 'unknown');
    batchTemplatePreview.textContent = `${path}/${name}.png`;
  }

  function getCurrentBatchSettings() {
    return normalizeBatchSettings({
      types: {
        image: batchImage.checked,
        video: batchVideo.checked,
        gif: batchGif.checked
      },
      quality: batchQuality.value,
      dateRange: {
        start: batchDateStart.value,
        end: batchDateEnd.value
      },
      pathTemplate: batchPathTemplate.value,
      nameTemplate: batchNameTemplate.value
    }, imageQuality.value);
  }

  function applyBatchSettings(batchSettings) {
    batchImage.checked = batchSettings.types.image;
    batchVideo.checked = batchSettings.types.video;
    batchGif.checked = batchSettings.types.gif;
    batchQuality.value = batchSettings.quality;
    batchDateStart.value = batchSettings.dateRange.start;
    batchDateEnd.value = batchSettings.dateRange.end;
    batchPathTemplate.value = batchSettings.pathTemplate;
    batchNameTemplate.value = batchSettings.nameTemplate;
    renderBatchTemplatePreview(batchSettings);
  }

  function persistBatchSettings(batchSettings, callback) {
    chrome.storage.sync.set({ batchSettings }, () => callback?.());
  }

  function saveBatchSettings(showSavedStatus = false) {
    const batchSettings = getCurrentBatchSettings();
    const validationError = validateBatchSettings(batchSettings);
    if (validationError) {
      showStatus(validationError, 'error');
      return null;
    }

    applyBatchSettings(batchSettings);
    persistBatchSettings(batchSettings, () => {
      if (showSavedStatus) {
        showStatus('批量下载设置已保存', 'success');
      }
    });
    return batchSettings;
  }

  const batchSettingInputs = [batchImage, batchVideo, batchGif, batchQuality, batchDateStart, batchDateEnd, batchPathTemplate, batchNameTemplate];
  let statusRefreshTimer = null;

  // 默认设置
  const defaultSettings = {
    enablePreview: true,
    enableImagePreview: true,
    enableGifPreview: true,
    previewTriggerMode: 'auto',
    previewTriggerKey: 'shift',
    previewDelay: 300,
    previewFollowMouse: true,
    imageQuality: '4096x4096',
    batchSettings: getDefaultBatchSettings()
  };

  batchSettingInputs.forEach((input) => {
    input.addEventListener('input', () => {
      renderBatchTemplatePreview(getCurrentBatchSettings());
    });
    input.addEventListener('change', () => {
      renderBatchTemplatePreview(getCurrentBatchSettings());
    });
  });

  function formatRelativeTime(timestamp) {
    if (!timestamp) return '暂无下载记录';
    const diffMs = Date.now() - timestamp;
    if (diffMs < 60 * 1000) return '刚刚更新';
    const diffMinutes = Math.floor(diffMs / (60 * 1000));
    if (diffMinutes < 60) return `${diffMinutes} 分钟前更新`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时前更新`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} 天前更新`;
  }

  function getStatusLabel(status) {
    if (status === 'resolving') return '解析中';
    if (status === 'downloading') return '下载中';
    if (status === 'completed') return '已完成';
    if (status === 'failed') return '失败';
    return '未知';
  }

  function getTypeLabel(type) {
    if (type === 'image') return '图片';
    if (type === 'video') return '视频';
    if (type === 'gif') return 'GIF';
    return '文件';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function renderDownloadStatusCenter(center) {
    const summary = center?.summary || {};
    const items = Array.isArray(center?.items) ? center.items : [];

    downloadStatusResolving.textContent = summary.resolving || 0;
    downloadStatusDownloading.textContent = summary.downloading || 0;
    downloadStatusCompleted.textContent = summary.completed || 0;
    downloadStatusFailed.textContent = summary.failed || 0;
    downloadStatusTotal.textContent = summary.total || 0;
    downloadStatusUpdated.textContent = formatRelativeTime(center?.updatedAt || 0);

    if (!items.length) {
      downloadStatusList.innerHTML = '<div class="download-status-empty">暂无下载记录</div>';
      return;
    }

    downloadStatusList.innerHTML = items.slice(0, 6).map((item) => {
      const status = item.status || 'downloading';
      const sourceText = item.source === 'batch'
        ? '批量下载'
        : item.source === 'quick-batch'
          ? 'Popup 批量'
          : '单项下载';
      const metaParts = [getTypeLabel(item.type), sourceText];
      if (item.folder) metaParts.push(item.folder);

      return `
        <div class="download-status-item">
          <div class="download-status-item-head">
            <div class="download-status-name">${escapeHtml(item.fileName || 'unknown')}</div>
            <div class="download-status-badge ${escapeHtml(status)}">${escapeHtml(getStatusLabel(status))}</div>
          </div>
          <div class="download-status-meta">${escapeHtml(metaParts.join(' · '))}</div>
          <div class="download-status-message">${escapeHtml(item.message || '等待更新')}</div>
        </div>
      `;
    }).join('');
  }

  function refreshDownloadStatusCenter() {
    chrome.runtime.sendMessage({ action: 'getDownloadStatusCenter' }, (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        downloadStatusUpdated.textContent = '暂时无法读取下载状态';
        return;
      }
      renderDownloadStatusCenter(response.center);
    });
  }

  function startStatusRefreshLoop() {
    refreshDownloadStatusCenter();
    if (statusRefreshTimer) {
      clearInterval(statusRefreshTimer);
    }
    statusRefreshTimer = setInterval(refreshDownloadStatusCenter, 2000);
  }

  // 加载设置
  function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (items) => {
      enablePreview.checked = items.enablePreview;
      enableImagePreview.checked = items.enableImagePreview;
      enableGifPreview.checked = items.enableGifPreview;
      previewTriggerMode.value = items.previewTriggerMode;
      previewTriggerKey.value = items.previewTriggerKey;
      previewDelay.value = items.previewDelay;
      previewDelayValue.textContent = items.previewDelay + 'ms';
      imageQuality.value = items.imageQuality;
      applyBatchSettings(normalizeBatchSettings(items.batchSettings, items.imageQuality));

      // 根据触发模式显示/隐藏按键选择
      triggerKeyItem.style.display = items.previewTriggerMode === 'key' ? 'flex' : 'none';
    });
  }

  // 触发模式切换时显示/隐藏按键选择
  previewTriggerMode.addEventListener('change', function () {
    triggerKeyItem.style.display = this.value === 'key' ? 'flex' : 'none';
  });

  // 开关切换时自动保存
  enablePreview.addEventListener('change', saveSettings);
  enableImagePreview.addEventListener('change', saveSettings);
  enableGifPreview.addEventListener('change', saveSettings);
  previewTriggerMode.addEventListener('change', saveSettings);
  previewTriggerKey.addEventListener('change', saveSettings);
  previewDelay.addEventListener('change', saveSettings);
  imageQuality.addEventListener('change', saveSettings);

  // 保存设置
  function saveSettings() {
    const batchSettings = getCurrentBatchSettings();
    const validationError = validateBatchSettings(batchSettings);
    if (validationError) {
      showStatus(validationError, 'error');
      return;
    }

    const settings = {
      enablePreview: enablePreview.checked,
      enableImagePreview: enableImagePreview.checked,
      enableGifPreview: enableGifPreview.checked,
      previewTriggerMode: previewTriggerMode.value,
      previewTriggerKey: previewTriggerKey.value,
      previewDelay: parseInt(previewDelay.value),
      previewFollowMouse: true, // 始终强制为true
      imageQuality: imageQuality.value,
      batchSettings: batchSettings
    };

    chrome.storage.sync.set(settings, () => {
      applyBatchSettings(batchSettings);

      // 通知content script设置已更新
      notifyContentScript(settings);

      // 显示保存成功状态
      showStatus('设置已保存', 'success');
    });
  }

  // 通知content script设置已更新
  function notifyContentScript(settings) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'settingsUpdated',
          settings: settings
        }).catch(() => {
          // 忽略标签页未加载扩展的错误
        });
      }
    });
  }

  // 执行批量下载
  function executeBatchDownload() {
    const batchSettings = saveBatchSettings();
    if (!batchSettings) return;

    // 检查是否在X/Twitter页面
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (!currentTab || (!currentTab.url.includes('x.com') && !currentTab.url.includes('twitter.com'))) {
        showStatus('请在X/Twitter页面上使用批量下载', 'error');
        return;
      }

      // 发送批量下载请求到content script
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'batchDownload',
        filters: batchSettings
      }, (response) => {
        if (chrome.runtime.lastError) {
          showStatus('请刷新页面后重试', 'error');
        } else {
          showStatus('开始批量下载...', 'success');
        }
      });
    });
  }

  // 重置设置
  function resetSettings() {
    chrome.storage.sync.set(defaultSettings, () => {
      loadSettings();
      showStatus('已重置为默认设置', 'success');
      notifyContentScript(defaultSettings);
    });
  }

  renderBatchTemplatePreview(getDefaultBatchSettings());

  // 显示状态消息
  function showStatus(message, type) {
    statusText.textContent = message;
    statusMessage.className = 'status show ' + (type === 'success' ? 'status-success' : 'status-error');

    // 2秒后隐藏
    setTimeout(() => {
      statusMessage.className = 'status';
    }, 2000);
  }

  // 预览延迟滑块变化事件
  previewDelay.addEventListener('input', function () {
    previewDelayValue.textContent = this.value + 'ms';
  });

  // 批量下载按钮点击事件
  batchDownloadBtn.addEventListener('click', executeBatchDownload);

  // 保存按钮点击事件
  saveBtn.addEventListener('click', saveSettings);

  // 重置按钮点击事件
  resetBtn.addEventListener('click', resetSettings);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshDownloadStatusCenter();
  });

  window.addEventListener('beforeunload', () => {
    if (statusRefreshTimer) {
      clearInterval(statusRefreshTimer);
    }
  });

  // 加载设置
  loadSettings();
  startStatusRefreshLoop();
});
