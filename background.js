// X/Twitter 原图下载器 - 后台脚本
// 参考开源项目: twitsave, gallery-dl, yt-dlp

const videoCache = new Map();
const DEBUG = true;

function log(...args) {
  if (DEBUG) {
    console.log('[X下载器]', new Date().toISOString(), ...args);
  }
}

function logError(...args) {
  console.error('[X下载器]', new Date().toISOString(), ...args);
}

/**
 * 监听消息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('收到消息:', message.action);
  
  if (message.action === 'downloadImage') {
    downloadImage(message.url, message.filename, message.folder)
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
  
  return false;
});

/**
 * 下载图片
 */
async function downloadImage(url, filename, folder) {
  const saveFolder = folder || 'X_Original_Images';
  const downloadId = await chrome.downloads.download({
    url: url,
    filename: `${saveFolder}/${filename}`,
    saveAs: false
  });
  log('图片下载已开始，ID:', downloadId);
  return downloadId;
}

/**
 * 处理视频下载 - 使用多种方法尝试
 */
async function handleVideoDownload({ tweetId, directVideoUrl, pageUrl, isGif, folder }) {
  log('========== 开始视频下载 ==========');
  log('参数:', { tweetId, directVideoUrl, pageUrl, isGif, folder });

  try {
    let videoUrl = null;
    let filename = isGif ? 'gif.mp4' : 'video.mp4';
    const saveFolder = folder || 'X_Videos';
    
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
    
    filename = tweetId ? (isGif ? `gif_${tweetId}.mp4` : `tweet_${tweetId}.mp4`) : filename;
    
    // 下载
    const downloadId = await chrome.downloads.download({
      url: videoUrl,
      filename: `${saveFolder}/${filename}`,
      saveAs: false
    });
    
    log('视频下载已开始，ID:', downloadId);
    log('========== 下载成功 ==========');
    
    return { success: true };
  } catch (error) {
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
  
  // 构建请求URL
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
  
  // 解析JSONP响应
  let data;
  try {
    // 尝试直接解析JSON
    data = JSON.parse(text);
  } catch (e) {
    // 可能是JSONP格式，提取JSON部分
    const match = text.match(/^[a-zA-Z0-9_]+\((.*)\)$/s);
    if (match) {
      data = JSON.parse(match[1]);
    } else {
      throw new Error('无法解析响应');
    }
  }
  
  log('Syndication数据结构:', Object.keys(data));
  
  // 提取视频信息
  const media = data?.mediaDetails?.[0] || 
                data?.entities?.media?.[0] ||
                data?.extended_entities?.media?.[0];
  
  if (!media) {
    log('数据:', JSON.stringify(data).substring(0, 500));
    throw new Error('未找到媒体信息');
  }
  
  const videoInfo = media.video_info;
  if (!videoInfo || !videoInfo.variants) {
    throw new Error('未找到视频信息');
  }
  
  // 找最高画质
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
    bestVideo = variants.find(v => v.type === 'video/mp4' || v.src?.includes('.mp4'));
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
 * 参考: https://docs.fxtwitter.com/
 * 2026年更新：改进API调用格式和错误处理
 */
async function fetchViaFixTweetAPI(tweetId) {
  log('FixTweet API请求，ID:', tweetId);

  // 尝试多种URL格式
  const urlFormats = [
    // 格式1: 使用screen_name
    `https://api.fxtwitter.com/i/status/${tweetId}`,
    // 格式2: 旧格式备用
    `https://api.fxtwitter.com/status/status/${tweetId}`,
    // 格式3: 直接使用tweet ID
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

      if (!response.ok) {
        continue; // 尝试下一个URL
      }

      const data = await response.json();

      // 提取视频信息 - 尝试多种数据路径
      let tweet = data?.tweet || data?.data?.tweet;

      if (!tweet) {
        // 可能返回的是threaded_conversation结构
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
          }
        }
      }

      if (!tweet) {
        continue; // 尝试下一个URL
      }

      // 提取媒体信息
      const media = tweet?.media || tweet?.legacy?.extended_entities?.media;
      if (!media) {
        continue; // 尝试下一个URL
      }

      // 获取视频列表
      let videos = [];

      if (Array.isArray(media)) {
        // 媒体是数组格式
        for (const m of media) {
          if (m.video_info?.variants) {
            videos = m.video_info.variants;
            break;
          }
          if (m.videos) {
            videos = m.videos;
            break;
          }
        }
      } else if (media.videos) {
        // 媒体是对象格式，包含videos数组
        videos = media.videos;
      } else if (media.video_info?.variants) {
        videos = media.video_info.variants;
      }

      if (!videos || videos.length === 0) {
        continue; // 尝试下一个URL
      }

      // 找最高画质视频 - 过滤掉m3u8
      let bestVideo = null;
      let highestBitrate = 0;

      for (const video of videos) {
        // 跳过m3u8播放列表
        if (video.content_type === 'application/x-mpegURL' ||
            video.type === 'application/x-mpegURL' ||
            video.url?.includes('.m3u8')) {
          continue;
        }

        // 优先选择MP4
        if (video.content_type?.includes('mp4') || video.url?.includes('.mp4')) {
          const bitrate = video.bitrate || 0;
          if (bitrate > highestBitrate) {
            highestBitrate = bitrate;
            bestVideo = video;
          }
        }
      }

      // 如果没找到MP4，尝试第一个非m3u8的视频
      if (!bestVideo) {
        for (const video of videos) {
          if (!video.url?.includes('.m3u8')) {
            bestVideo = video;
            break;
          }
        }
      }

      if (!bestVideo || !bestVideo.url) {
        continue; // 尝试下一个URL
      }

      log('FixTweet获取视频URL:', bestVideo.url);

      return { url: bestVideo.url, type: bestVideo.type || 'video' };

    } catch (e) {
      lastError = e;
      log('FixTweet URL尝试失败:', e.message);
      continue; // 尝试下一个URL
    }
  }

  throw new Error(lastError?.message || '所有FixTweet API格式都失败');
}

/**
 * 方案2: GraphQL API（需要登录）
 */
async function fetchViaGraphQLAPI(tweetId) {
  log('GraphQL API请求，ID:', tweetId);
  
  const cookies = await chrome.cookies.getAll({ domain: 'x.com' });
  if (cookies.length === 0) {
    throw new Error('未登录');
  }
  
  const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const csrfCookie = cookies.find(c => c.name === 'ct0');
  const csrfToken = csrfCookie ? csrfCookie.value : '';
  
  // 使用TweetDetail查询
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
  
  // 从threaded_conversation_with_injections中提取
  const instructions = data?.data?.threaded_conversation_with_injections?.instructions;
  if (!instructions) {
    throw new Error('未找到推文数据');
  }
  
  // 遍历查找推文
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
  
  // 获取视频
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
    bestVideo = variants.find(v => v.type === 'video/mp4');
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
  
  // 直接找MP4
  for (const line of lines) {
    if (line.includes('.mp4') && line.startsWith('http')) {
      return line.trim();
    }
  }
  
  // 找最高带宽流
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

// 下载完成监听
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === 'complete') {
    log('下载完成，ID:', delta.id);
  }
});

// 安装监听
chrome.runtime.onInstalled.addListener((details) => {
  log('扩展已安装/更新:', details.reason);
  videoCache.clear();
});

log('后台脚本已加载');
