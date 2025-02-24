/*!
 * Adaptus2Player - A Customizable Video.js Player
 * Version: 1.0.0
 * Repository: https://github.com/mataluis2k/Adaptus2Player
 * npm package: adaptus2-player
 *
 * Copyright (c) 2025 Luis B. Mata 
 *
 * Licensed under the MIT License. You may obtain a copy of the License at:
 * http://opensource.org/licenses/MIT
 *
 * Author: Luis B. Mata <[your.email@example.com]>
 * Date: [2025-02-14]
 *
 * Description:
 * Adaptus2Player is an easy-to-use, highly customizable Video.js player that 
 * provides features such as hero overlay for inline mobile playback, customizable 
 * call-to-action (CTA) display with configurable offset, redirect handling upon video 
 * completion, granular control over player features (volume, seek, controls), 
 * and optional playback tracking with a configurable interval.
 */
(function() {
  // Utility: Dynamically load a CSS file
  function loadCSS(href, callback) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    if (callback) {
      link.onload = callback;
    }
    document.head.appendChild(link);
  }

  // Utility: Dynamically load a JS file
  function loadScript(src, callback) {
    var script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = callback;
    document.head.appendChild(script);
  }

  /**
   * initVideoPlayer
   *
   * Inserts a Video.js player into a target container and sets up optional features.
   *
   * Options:
   *   targetDiv:       (string) CSS selector for the container to load the player into.
   *   videoSrc:        (string) URL of the video. (Default: '/myvideo.mp4')
   *   videoDuration:   (number) Total duration of the video in seconds. (Default: 300)
   *   heroImage:       (string) URL to a hero overlay image/GIF. When provided, the video
   *                    will be covered by this image until the user taps it to play.
   *   ctaText:         (string) HTML content for the offer/CTA section.
   *   redirectUrl:     (string) URL to redirect the user after the video ends.
   *   offerShowOffset: (number) Time (in seconds) before the end to show the CTA. (Default: 45)
   *
   *   --- Options for Controls ---
   *   showControls:    (boolean) Whether to display the Video.js controls. (Default: true)
   *   enableVolume:    (boolean) Whether to enable volume controls. (Default: true)
   *   enableSeek:      (boolean) Whether to enable seek/progress controls (fast-forward). (Default: true)
   *
   *   --- Options for Playback Tracking ---
   *   trackingUrl:     (string) If provided, the player will POST playback data to this URL.
   *   trackingInterval:(number) Interval in seconds between tracking events. (Default: 10)
   *
   *   --- Optional Callback ---
   *   fullscreenChangeCallback: (function) A callback function to be invoked on fullscreen change.
   *                             If provided, it receives the player instance as a parameter.
   */
  function initVideoPlayer(options) {
    options = options || {};
    var targetDivSelector = options.targetDiv || '#videoContainer';
    var videoSrc = options.videoSrc || '/myvideo.mp4';
    var videoDuration = options.videoDuration || 300; // default: 5 minutes
    var heroImage = options.heroImage; // optional hero overlay image/GIF URL
    var ctaText = options.ctaText;     // optional CTA HTML content
    var redirectUrl = options.redirectUrl; // optional redirect URL on video end
    var offerShowOffset = (typeof options.offerShowOffset === 'number') ? options.offerShowOffset : 45;

    // Options for controls
    var showControls = (typeof options.showControls !== 'undefined') ? options.showControls : true;
    var enableVolume = (typeof options.enableVolume !== 'undefined') ? options.enableVolume : true;
    var enableSeek = (typeof options.enableSeek !== 'undefined') ? options.enableSeek : true;

    // Options for tracking
    var trackingUrl = options.trackingUrl; // if provided, playback data will be sent here
    var trackingInterval = (typeof options.trackingInterval === 'number') ? options.trackingInterval : 10;

    // Optional fullscreen callback
    var fullscreenChangeCallback = options.fullscreenChangeCallback;

    // Find the target container
    var targetDiv = document.querySelector(targetDivSelector);
    if (!targetDiv) {
      console.error('initVideoPlayer: Target div not found for selector: ' + targetDivSelector);
      return;
    }

    // Determine whether to add the "controls" attribute to the <video> tag
    var controlsAttribute = showControls ? 'controls' : '';

    // Build the video player HTML with an optional hero overlay.
    // Note the addition of `playsinline` and `webkit-playsinline` to force inline playback on iOS.
    var videoWrapperStyles = 'position: relative; width: 640px; height: 360px;';
    var videoHTML = `
      <div class="video-wrapper" style="${videoWrapperStyles}">
        <video
          id="dynamic_video"
          class="video-js vjs-default-skin"
          ${controlsAttribute}
          playsinline
          webkit-playsinline
          preload="auto"
          width="640"
          height="360"
          data-setup="{}"
        >
          <source src="${videoSrc}" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        ${heroImage ? `
          <div id="hero-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: pointer;">
            <img src="${heroImage}" alt="Tap to play" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
        ` : ''}
      </div>
    `;

    // If CTA text is provided, create the CTA container.
    var ctaHTML = ctaText ? `
      <div id="offer" style="display: none; margin-top: 20px; padding: 10px; background: #f9f9f9; border: 1px solid #ccc;">
        ${ctaText}
      </div>
    ` : '';

    // Append the video and optional CTA to the target container.
    var container = document.createElement('div');
    container.innerHTML = videoHTML + ctaHTML;
    targetDiv.appendChild(container);

    // Create Video.js configuration based on control options.
    var videoConfig = {
      controls: showControls
    };
    if (showControls) {
      videoConfig.controlBar = {};
      // Disable volume panel if not enabled
      if (!enableVolume) {
        videoConfig.controlBar.volumePanel = false;
      }
      // Disable seek-related controls if not enabled
      if (!enableSeek) {
        videoConfig.controlBar.progressControl = false;
        videoConfig.controlBar.currentTimeDisplay = false;
        videoConfig.controlBar.timeDivider = false;
        videoConfig.controlBar.durationDisplay = false;
      }
    }

    // Function to initialize Video.js and set up event listeners.
    function setupPlayer() {
      var player = videojs('dynamic_video', videoConfig);
      player.ready(function() {
        // If a hero overlay exists, attach a click handler to hide it and start playback.
        var heroOverlay = document.getElementById('hero-overlay');
        if (heroOverlay) {
          heroOverlay.addEventListener('click', function() {
            heroOverlay.style.display = 'none';
            player.play();
          });
        }

        // If CTA exists, show it when the current time reaches the designated offset.
        var offerDiv = document.getElementById('offer');
        if (offerDiv) {
          player.on('timeupdate', function() {
            if (player.currentTime() >= (videoDuration - offerShowOffset)) {
              if (offerDiv.style.display === 'none') {
                offerDiv.style.display = 'block';
              }
            }
          });
        }

        // If a redirect URL is provided, redirect when the video ends.
        if (redirectUrl) {
          player.on('ended', function() {
            window.location.href = redirectUrl;
          });
        }

        // If tracking is enabled, post playback data to the specified tracking URL.
        if (trackingUrl) {
          let lastTracked = 0;
          player.on('timeupdate', function() {
            var currentTime = player.currentTime();
            if (currentTime - lastTracked >= trackingInterval) {
              lastTracked = currentTime;
              fetch(trackingUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playbackTime: currentTime, videoSrc: videoSrc })
              }).catch(err => console.error('Tracking error:', err));
            }
          });
        }

        // Optional fullscreen change callback.
        if (fullscreenChangeCallback && typeof fullscreenChangeCallback === 'function') {
          player.on('fullscreenchange', function() {
            fullscreenChangeCallback(player);
          });
        }
      });
    }

    // Ensure Video.js is loaded. If not, load it from the CDN.
    if (window.videojs) {
      setupPlayer();
    } else {
      loadScript('https://vjs.zencdn.net/7.20.3/video.min.js', setupPlayer);
    }
  }

  // Load Video.js CSS from the CDN (if not already loaded)
  loadCSS('https://vjs.zencdn.net/7.20.3/video-js.css');

  // Expose the initVideoPlayer function globally.
  window.initVideoPlayer = initVideoPlayer;

  // Example auto-initialization (commented out):
  /*
  initVideoPlayer({
    targetDiv: '#videoContainer',
    videoSrc: '/myvideo.mp4',
    videoDuration: 300,
    heroImage: '/path/to/hero.gif',
    ctaText: '<h2>Special Offer!</h2><p>Unlock a discount by watching this video.</p>',
    redirectUrl: '/checkout_page',
    offerShowOffset: 45,
    showControls: true,
    enableVolume: true,
    enableSeek: false,
    trackingUrl: 'https://your-tracking-endpoint.com/track',
    trackingInterval: 10,
    fullscreenChangeCallback: function(player) {
      // Reapply settings or log fullscreen state if needed.
      console.log('Fullscreen changed. Is fullscreen:', player.isFullscreen());
    }
  });
  */
})();
