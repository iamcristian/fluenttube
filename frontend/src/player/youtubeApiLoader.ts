let apiPromise: Promise<void> | null = null;
const readyCallbacks: Array<() => void> = [];

/**
 * Loads the YouTube IFrame API script exactly once using a shared Promise.
 * Manages the global window.onYouTubeIframeAPIReady callback cleanly
 * without overwriting other potential consumers.
 */
export function loadYouTubeIframeApi(): Promise<void> {
  // If window.YT and Player are already loaded, resolve immediately
  if (typeof window !== 'undefined' && window.YT && window.YT.Player) {
    return Promise.resolve();
  }

  if (apiPromise) {
    return apiPromise;
  }

  apiPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('YouTube API cannot be loaded outside a browser environment.'));
      return;
    }

    // Register resolve callback
    readyCallbacks.push(resolve);

    // Save any existing hook
    const previousReady = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') {
        try {
          previousReady();
        } catch (e) {
          console.warn('Error in previous onYouTubeIframeAPIReady hook:', e);
        }
      }

      while (readyCallbacks.length > 0) {
        const cb = readyCallbacks.shift();
        if (cb) cb();
      }
    };

    // Check if script tag is already in DOM
    const existingScript = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (existingScript) {
      // Script is already added, wait for callback
      return;
    }

    // Inject iframe API script
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error('Failed to load YouTube IFrame API script.'));
    };

    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  });

  return apiPromise;
}

/**
 * Resets loader singleton state for testing purposes.
 */
export function resetYouTubeApiLoaderForTesting(): void {
  apiPromise = null;
  readyCallbacks.length = 0;
}
