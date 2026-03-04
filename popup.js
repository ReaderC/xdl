// X/Twitter 原图下载器 - Popup脚本 (设置页面)

document.addEventListener('DOMContentLoaded', function () {
  // 获取DOM元素
  const enablePreview = document.getElementById('enablePreview');
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
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');
  const statusMessage = document.getElementById('statusMessage');
  const statusText = document.getElementById('statusText');

  // 默认设置
  const defaultSettings = {
    enablePreview: true,
    previewTriggerMode: 'auto',
    previewTriggerKey: 'shift',
    previewDelay: 300,
    previewFollowMouse: true,
    imageQuality: '4096x4096'
  };

  // 加载设置
  function loadSettings() {
    chrome.storage.sync.get(defaultSettings, (items) => {
      enablePreview.checked = items.enablePreview;
      previewTriggerMode.value = items.previewTriggerMode;
      previewTriggerKey.value = items.previewTriggerKey;
      previewDelay.value = items.previewDelay;
      previewDelayValue.textContent = items.previewDelay + 'ms';
      imageQuality.value = items.imageQuality;

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
  previewTriggerMode.addEventListener('change', saveSettings);
  previewTriggerKey.addEventListener('change', saveSettings);
  previewDelay.addEventListener('change', saveSettings);
  imageQuality.addEventListener('change', saveSettings);

  // 保存设置
  function saveSettings() {
    const settings = {
      enablePreview: enablePreview.checked,
      previewTriggerMode: previewTriggerMode.value,
      previewTriggerKey: previewTriggerKey.value,
      previewDelay: parseInt(previewDelay.value),
      previewFollowMouse: true, // 始终强制为true
      imageQuality: imageQuality.value
    };

    chrome.storage.sync.set(settings, () => {
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
    // 检查是否在X/Twitter页面
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];
      if (!currentTab || (!currentTab.url.includes('x.com') && !currentTab.url.includes('twitter.com'))) {
        showStatus('请在X/Twitter页面上使用批量下载', 'error');
        return;
      }

      // 收集批量下载选项
      const mediaTypes = [];
      if (batchImage.checked) mediaTypes.push('image');
      if (batchVideo.checked) mediaTypes.push('video');
      if (batchGif.checked) mediaTypes.push('gif');

      if (mediaTypes.length === 0) {
        showStatus('请至少选择一种媒体类型', 'error');
        return;
      }

      // 发送批量下载请求到content script
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'batchDownload',
        filters: {
          mediaTypes: mediaTypes,
          quality: batchQuality.value,
          dateRange: null
        }
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

  // 加载设置
  loadSettings();
});
