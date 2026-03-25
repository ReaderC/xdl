// X/Twitter 原图下载器 - 后台脚本
// 参考开源项目: twitsave, gallery-dl, yt-dlp

const videoCache = new Map();
const DEBUG = true;
const DOWNLOAD_STATUS_KEY = 'downloadStatusCenter';
const MAX_DOWNLOAD_STATUS_ITEMS = 30;

function log(...args) {
  if (DEBUG) {
    console.log('[X下载器]', new Date().toISOString(), ...args);
  }
}

function logError(...args) {
  console.error('[X下载器]', new Date().toISOString(), ...args);
}

function storageLocalGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });
}

function storageLocalSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });
}

function createEmptyDownloadStatusCenter() {
  return {
    items: [],
    summary: {
      resolving: 0,
      downloading: 0,
      completed: 0,
      failed: 0,
      total: 0
    },
    updatedAt: 0
  };
}

function summarizeDownloadStatuses(items) {
  const summary = {
    resolving: 0,
    downloading: 0,
    completed: 0,
    failed: 0,
    total: items.length
  };

  items.forEach((item) => {
    if (summary[item.status] !== undefined) {
      summary[item.status] += 1;
    }
  });

  return summary;
}

function normalizeDownloadStatusCenter(rawCenter) {
  const items = Array.isArray(rawCenter?.items)
    ? rawCenter.items
      .filter(Boolean)
      .map((item) => ({
        id: item.id,
        status: item.status || 'downloading',
        type: item.type || 'file',
        fileName: item.fileName || 'unknown',
        folder: item.folder || '',
        targetPath: item.targetPath || item.fileName || 'unknown',
        message: item.message || '',
        error: item.error || '',
        downloadId: typeof item.downloadId === 'number' ? item.downloadId : null,
        createdAt: Number(item.createdAt) || Date.now(),
        updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
        completedAt: Number(item.completedAt) || null,
        source: item.source || 'manual'
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DOWNLOAD_STATUS_ITEMS)
    : [];

  return {
    items,
    summary: summarizeDownloadStatuses(items),
    updatedAt: Number(rawCenter?.updatedAt) || (items[0]?.updatedAt || 0)
  };
}

async function getDownloadStatusCenter() {
  const result = await storageLocalGet(DOWNLOAD_STATUS_KEY);
  return normalizeDownloadStatusCenter(result[DOWNLOAD_STATUS_KEY]);
}

async function saveDownloadStatusCenter(center) {
  const normalized = normalizeDownloadStatusCenter(center);
  await storageLocalSet({ [DOWNLOAD_STATUS_KEY]: normalized });
  return normalized;
}

function createDownloadStatusId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTargetPath(folder, fileName, fallbackFolder = '') {
  const resolvedFolder = folder || fallbackFolder;
  return resolvedFolder ? `${resolvedFolder}/${fileName}` : fileName;
}

function getSafeFolder(folder, fallbackFolder) {
  return folder || fallbackFolder;
}

function getSafeFileName(fileName, fallbackFileName) {
  return (typeof fileName === 'string' && fileName.trim()) ? fileName : fallbackFileName;
}

async function upsertDownloadStatus(patch) {
  const center = await getDownloadStatusCenter();
  const items = [...center.items];
  const index = items.findIndex((item) => item.id === patch.id);
  const previous = index >= 0 ? items[index] : null;
  const now = Date.now();

  const nextItem = {
    ...previous,
    ...patch,
    createdAt: previous?.createdAt || patch.createdAt || now,
    updatedAt: now
  };

  if ((nextItem.status === 'completed' || nextItem.status === 'failed') && !nextItem.completedAt) {
    nextItem.completedAt = now;
  }

  if (index >= 0) {
    items[index] = nextItem;
  } else {
    items.unshift(nextItem);
  }

  return saveDownloadStatusCenter({
    items,
    updatedAt: now
  });
}

async function updateDownloadStatusByDownloadId(downloadId, patch) {
  const center = await getDownloadStatusCenter();
  const item = center.items.find((entry) => entry.downloadId === downloadId);
  if (!item) return null;

  return upsertDownloadStatus({
    ...item,
    ...patch,
    id: item.id
  });
}

async function beginTrackedDownload({ type, fileName, folder, source, status, message }) {
  const entryId = createDownloadStatusId();
  await upsertDownloadStatus({
    id: entryId,
    type,
    fileName,
    folder,
    targetPath: buildTargetPath(folder, fileName),
    source: source || 'manual',
    status,
    message
  });
  return entryId;
}

async function markTrackedDownloadQueued(entryId, downloadId, { type, fileName, folder, source, message }) {
  await upsertDownloadStatus({
    id: entryId,
    type,
    fileName,
    folder,
    targetPath: buildTargetPath(folder, fileName),
    source: source || 'manual',
    downloadId,
    status: 'downloading',
    message: message || '已加入浏览器下载队列'
  });
}

async function markTrackedDownloadFailed(entryId, error, { type, fileName, folder, source }) {
  const message = error?.message || '下载失败';
  await upsertDownloadStatus({
    id: entryId,
    type,
    fileName,
    folder,
    targetPath: buildTargetPath(folder, fileName),
    source: source || 'manual',
    status: 'failed',
    message,
    error: message
  });
}

async function clearStaleResolvingDownloads() {
  const center = await getDownloadStatusCenter();
  const staleThreshold = Date.now() - 1000 * 60 * 60 * 12;
  const staleItems = center.items.filter((item) => item.status === 'resolving' && item.updatedAt < staleThreshold);

  await Promise.all(staleItems.map((item) => upsertDownloadStatus({
    id: item.id,
    status: 'failed',
    message: '后台已重启，请重新发起下载',
    error: 'service_worker_restarted'
  })));
}

async function ensureDownloadStatusCenter() {
  const center = await getDownloadStatusCenter();
  if (!center.updatedAt) {
    await saveDownloadStatusCenter(center);
  }
}

ensureDownloadStatusCenter();
clearStaleResolvingDownloads();

/**
 * 监听消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('收到消息:', message.action);

  if (message.action === 'downloadImage') {
    downloadImage(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'downloadVideo') {
    handleVideoDownload(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getDownloadStatusCenter') {
    getDownloadStatusCenter()
      .then((center) => sendResponse({ success: true, center }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

/**
 * 下载图片
 */
async function downloadImage({ url, filename, folder, source }) {
  const saveFolder = getSafeFolder(folder, 'X_Original_Images');
  const finalFilename = getSafeFileName(filename, 'image.jpg');
  const entryId = await beginTrackedDownload({
    type: 'image',
    fileName: finalFilename,
    folder: saveFolder,
    source,
    status: 'downloading',
    message: '正在加入下载队列'
  });

  try {
    const downloadId = await chrome.downloads.download({
      url,
      filename: `${saveFolder}/${finalFilename}`,
      saveAs: false
    });

    await markTrackedDownloadQueued(entryId, downloadId, {
      type: 'image',
      fileName: finalFilename,
      folder: saveFolder,
      source
    });

    log('图片下载已开始，ID:', downloadId);
    return downloadId;
  } catch (error) {
    await markTrackedDownloadFailed(entryId, error, {
      type: 'image',
      fileName: finalFilename,
      folder: saveFolder,
      source
    });
    throw error;
  }
}

/**
 * 处理视频下载 - 使用多种方法尝试
 */
async function handleVideoDownload({ tweetId, directVideoUrl, pageUrl, isGif, filename, folder, source }) {
  log('========== 开始视频下载 ==========');
  log('参数:', { tweetId, directVideoUrl, pageUrl, isGif, filename, folder, source });

  const type = isGif ? 'gif' : 'video';
  const saveFolder = getSafeFolder(folder, 'X_Videos');
  const finalFilename = getSafeFileName(filename, tweetId ? (isGif ? `gif_${tweetId}.mp4` : `tweet_${tweetId}.mp4`) : (isGif ? 'gif.mp4' : 'video.mp4'));
  const entryId = await beginTrackedDownload({
    type,
    fileName: finalFilename,
    folder: saveFolder,
    source,
    status: 'resolving',
    message: isGif ? '正在解析 GIF 下载链接' : '正在解析视频下载链接'
  });

  try {
    let videoUrl = null;

    // 检查缓存
    if (tweetId && videoCache.has(tweetId)) {
      videoUrl = videoCache.get(tweetId);
      log('使用缓存URL');
    }

    // 方案1: 直接视频URL
    if (!videoUrl && directVideoUrl && !directVideoUrl.includes('.m3u8')) {
      videoUrl = directVideoUrl;
      log('使用直接URL');
    }

    // 方案2: 使用Syndication API（不需要认证，最可靠）
    if (!videoUrl && tweetId) {
      log('尝试Syndication API...');
      try {
        const videoInfo = await fetchViaSyndicationAPI(tweetId);
        if (videoInfo && videoInfo.url) {
          videoUrl = videoInfo.url;
          log('Syndication API成功');
        }
      } catch (e) {
        logError('Syndication API失败:', e.message);
      }
    }

    // 方案2.5: 使用FixTweet API（不需要认证，最稳定）
    if (!videoUrl && tweetId) {
      log('尝试FixTweet API...');
      try {
        const videoInfo = await fetchViaFixTweetAPI(tweetId);
        if (videoInfo && videoInfo.url) {
          videoUrl = videoInfo.url;
          log('FixTweet API成功');
        }
      } catch (e) {
        logError('FixTweet API失败:', e.message);
      }
    }

    // 方案3: 使用GraphQL API（需要登录）
    if (!videoUrl && tweetId) {
      log('尝试GraphQL API...');
      try {
        const videoInfo = await fetchViaGraphQLAPI(tweetId);
        if (videoInfo && videoInfo.url) {
          videoUrl = videoInfo.url;
          log('GraphQL API成功');
        }
      } catch (e) {
        logError('GraphQL API失败:', e.message);
      }
    }

    // 方案4: 解析m3u8
    if (!videoUrl && directVideoUrl && directVideoUrl.includes('.m3u8')) {
      log('尝试解析m3u8...');
      try {
        videoUrl = await parseM3u8(directVideoUrl);
        if (videoUrl) log('m3u8解析成功');
      } catch (e) {
        logError('m3u8解析失败:', e.message);
      }
    }

    if (!videoUrl) {
      throw new Error('无法获取视频链接，请确保推文存在且包含视频');
    }

    // 缓存结果
    if (tweetId) {
      videoCache.set(tweetId, videoUrl);
    }

    const downloadId = await chrome.downloads.download({
      url: videoUrl,
      filename: `${saveFolder}/${finalFilename}`,
      saveAs: false
    });

    await markTrackedDownloadQueued(entryId, downloadId, {
      type,
      fileName: finalFilename,
      folder: saveFolder,
      source,
      message: '已加入浏览器下载队列'
    });

    log('视频下载已开始，ID:', downloadId);
    log('========== 下载成功 ==========');

    return { success: true, downloadId };
  } catch (error) {
    await markTrackedDownloadFailed(entryId, error, {
      type,
      fileName: finalFilename,
      folder: saveFolder,
      source
    });

    logError('视频下载失败:', error);
    log('========== 下载失败 ==========');
    return { success: false, error: error.message };
  }
}

/**
 * 方案1: Syndication API（公开API，不需要认证）
 * 参考: https://github.com/JustKowali/twitsave
 */
async function fetchViaSyndicationAPI(tweetId) {
  log('Syndication API请求，ID:', tweetId);

  const url = `https://syndication.twitter.com/tweet-result?id=${tweetId}&token=0`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': '*/*',
      'Referer': 'https://platform.twitter.com/',
      'Origin': 'https://platform.twitter.com'
    }
  });

  log('Syndication响应状态:', response.status);

  if (!response.ok) {
    throw new Error(`Syndication API失败: ${response.status}`);
  }

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (e) {
    const match = text.match(/^[a-zA-Z0-9_]+\((.*)\)$/s);
    if (match) {
      data = JSON.parse(match[1]);
    } else {
      throw new Error('无法解析响应');
    }
  }

  log('Syndication数据结构:', Object.keys(data));

  const media = data?.mediaDetails?.[0] || data?.entities?.media?.[0] || data?.extended_entities?.media?.[0];
  if (!media) {
    log('数据:', JSON.stringify(data).substring(0, 500));
    throw new Error('未找到媒体信息');
  }

  const videoInfo = media.video_info;
  if (!videoInfo || !videoInfo.variants) {
    throw new Error('未找到视频信息');
  }

  const variants = videoInfo.variants;
  let bestVideo = null;
  let highestBitrate = 0;

  for (const variant of variants) {
    if (variant.type === 'video/mp4' || (variant.src && variant.src.includes('.mp4'))) {
      const bitrate = variant.bitrate || 0;
      if (bitrate > highestBitrate) {
        highestBitrate = bitrate;
        bestVideo = variant;
      }
    }
  }

  if (!bestVideo) {
    bestVideo = variants.find((v) => v.type === 'video/mp4' || v.src?.includes('.mp4'));
  }

  if (!bestVideo || (!bestVideo.src && !bestVideo.url)) {
    throw new Error('未找到MP4视频');
  }

  const videoUrl = bestVideo.src || bestVideo.url;
  log('Syndication获取视频URL:', videoUrl);
  return { url: videoUrl, bitrate: highestBitrate };
}

/**
 * 方案2.5: FixTweet API（公开API，不需要认证，最稳定）
 */
async function fetchViaFixTweetAPI(tweetId) {
  log('FixTweet API请求，ID:', tweetId);

  const urlFormats = [
    `https://api.fxtwitter.com/i/status/${tweetId}`,
    `https://api.fxtwitter.com/status/status/${tweetId}`,
    `https://api.fxtwitter.com/tweet/${tweetId}`
  ];

  let lastError = null;

  for (const url of urlFormats) {
    try {
      log('尝试FixTweet URL:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Referer': 'https://fxtwitter.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      log('FixTweet响应状态:', response.status);
      if (!response.ok) continue;

      const data = await response.json();
      let tweet = data?.tweet || data?.data?.tweet;

      if (!tweet) {
        const instructions = data?.data?.threaded_conversation_with_injections?.instructions;
        if (instructions) {
          for (const instruction of instructions) {
            if (instruction.type === 'TimelineAddEntries') {
              for (const entry of instruction.entries || []) {
                if (entry.content?.itemContent?.tweet_results?.result) {
                  tweet = entry.content.itemContent.tweet_results.result;
                  break;
                }
              }
            }
            if (tweet) break;
          }
        }
      }

      if (!tweet) continue;

      const media = tweet?.media || tweet?.legacy?.extended_entities?.media;
      if (!media) continue;

      let videos = [];
      if (Array.isArray(media)) {
        for (const item of media) {
          if (item.video_info?.variants) {
            videos = item.video_info.variants;
            break;
          }
          if (item.videos) {
            videos = item.videos;
            break;
          }
        }
      } else if (media.videos) {
        videos = media.videos;
      } else if (media.video_info?.variants) {
        videos = media.video_info.variants;
      }

      if (!videos.length) continue;

      let bestVideo = null;
      let highestBitrate = 0;

      for (const video of videos) {
        if (video.content_type === 'application/x-mpegURL' || video.type === 'application/x-mpegURL' || video.url?.includes('.m3u8')) {
          continue;
        }

        if (video.content_type?.includes('mp4') || video.url?.includes('.mp4')) {
          const bitrate = video.bitrate || 0;
          if (bitrate > highestBitrate) {
            highestBitrate = bitrate;
            bestVideo = video;
          }
        }
      }

      if (!bestVideo) {
        bestVideo = videos.find((video) => !video.url?.includes('.m3u8'));
      }

      if (!bestVideo?.url) continue;

      log('FixTweet获取视频URL:', bestVideo.url);
      return { url: bestVideo.url, type: bestVideo.type || 'video' };
    } catch (e) {
      lastError = e;
      log('FixTweet URL尝试失败:', e.message);
    }
  }

  throw new Error(lastError?.message || '所有FixTweet API格式都失败');
}

/**
 * 方案3: GraphQL API（需要登录）
 */
async function fetchViaGraphQLAPI(tweetId) {
  log('GraphQL API请求，ID:', tweetId);

  const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
  if (cookies.length === 0) {
    throw new Error('未登录');
  }

  const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const csrfCookie = cookies.find((c) => c.name === 'ct0');
  const csrfToken = csrfCookie ? csrfCookie.value : '';

  const variables = {
    focalTweetId: tweetId,
    with_rux_injections: false,
    includePromotedContent: false,
    withCommunity: false,
    withQuickPromoteEligibilityTweetFields: false,
    withBirdwatchNotes: false,
    withVoice: false,
    withV2Timeline: false
  };

  const features = {
    rweb_tipjar_consumption_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    communities_web_enable_tweet_community_results_fetch: false,
    c9s_tweet_anatomy_moderator_badge_enabled: false,
    articles_preview_enabled: false,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: false,
    view_counts_everywhere_api_enabled: false,
    longform_notetweets_consumption_enabled: false,
    responsive_web_twitter_article_tweet_consumption_enabled: false,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: false,
    standardized_nudges_misinfo: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
    rweb_video_timestamps_enabled: false,
    longform_notetweets_rich_text_read_enabled: false,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_enhance_cards_enabled: false
  };

  const url = `https://x.com/i/api/graphql/VWFGpvAGCtcBgsfgJLoWLA/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      'X-Csrf-Token': csrfToken,
      'Cookie': cookieString,
      'Content-Type': 'application/json',
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes'
    }
  });

  log('GraphQL响应状态:', response.status);
  if (!response.ok) {
    throw new Error(`GraphQL API失败: ${response.status}`);
  }

  const data = await response.json();
  const instructions = data?.data?.threaded_conversation_with_injections?.instructions;
  if (!instructions) {
    throw new Error('未找到推文数据');
  }

  let tweetResult = null;
  for (const instruction of instructions) {
    if (instruction.type === 'TimelineAddEntries') {
      for (const entry of instruction.entries || []) {
        if (entry.entryId?.includes(tweetId)) {
          tweetResult = entry.content?.itemContent?.tweet_results?.result;
          break;
        }
      }
    }
    if (tweetResult) break;
  }

  if (!tweetResult) {
    throw new Error('未找到推文');
  }

  const legacy = tweetResult.legacy || tweetResult;
  const media = legacy?.extended_entities?.media?.[0] || legacy?.entities?.media?.[0];
  if (!media || !media.video_info) {
    throw new Error('未找到视频');
  }

  const variants = media.video_info.variants;
  let bestVideo = null;
  let highestBitrate = 0;

  for (const variant of variants) {
    if (variant.type === 'video/mp4') {
      const bitrate = variant.bitrate || 0;
      if (bitrate > highestBitrate) {
        highestBitrate = bitrate;
        bestVideo = variant;
      }
    }
  }

  if (!bestVideo) {
    bestVideo = variants.find((variant) => variant.type === 'video/mp4');
  }

  if (!bestVideo) {
    throw new Error('未找到MP4视频');
  }

  log('GraphQL获取视频URL:', bestVideo.url);
  return { url: bestVideo.url, bitrate: highestBitrate };
}

/**
 * 解析m3u8
 */
async function parseM3u8(m3u8Url) {
  const response = await fetch(m3u8Url);
  const text = await response.text();
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.includes('.mp4') && line.startsWith('http')) {
      return line.trim();
    }
  }

  let bestStream = null;
  let bestBandwidth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const match = line.match(/BANDWIDTH=(\d+)/);
      if (match) {
        const bandwidth = parseInt(match[1]);
        if (bandwidth > bestBandwidth) {
          bestBandwidth = bandwidth;
          const nextLine = lines[i + 1];
          if (nextLine && !nextLine.startsWith('#')) {
            bestStream = nextLine.trim();
          }
        }
      }
    }
  }

  if (bestStream) {
    if (bestStream.startsWith('http')) {
      return bestStream;
    }
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    return baseUrl + bestStream;
  }

  return null;
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state?.current && !delta.error?.current && !delta.filename?.current) return;

  updateDownloadStatusByDownloadId(delta.id, {
    fileName: delta.filename?.current ? delta.filename.current.split(/[\\/]/).pop() : undefined,
    folder: delta.filename?.current ? delta.filename.current.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined,
    targetPath: delta.filename?.current ? delta.filename.current.replace(/\\/g, '/') : undefined,
    status: delta.state?.current === 'complete' ? 'completed' : delta.state?.current === 'interrupted' ? 'failed' : undefined,
    message: delta.state?.current === 'complete'
      ? '下载完成'
      : delta.state?.current === 'interrupted'
        ? `下载失败: ${delta.error?.current || 'interrupted'}`
        : undefined,
    error: delta.state?.current === 'interrupted' ? (delta.error?.current || 'interrupted') : undefined
  }).catch((error) => {
    logError('同步下载状态失败:', error.message);
  });

  if (delta.state?.current === 'complete') {
    log('下载完成，ID:', delta.id);
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  log('扩展已安装/更新:', details.reason);
  videoCache.clear();
});

log('后台脚本已加载');
