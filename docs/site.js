(() => {
  const downloadLink = document.querySelector('[data-download-link]');
  if (!downloadLink) {
    return;
  }

  const releasesUrl =
    downloadLink.getAttribute('href') || 'https://github.com/chinaliyun92/novarterm/releases';
  const apiUrl = 'https://api.github.com/repos/chinaliyun92/novarterm/releases/latest';

  const originalLabel = downloadLink.textContent || 'Download Beta';
  downloadLink.setAttribute('aria-busy', 'true');

  fetch(apiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      const asset = pickAsset(data && data.assets);
      if (!asset) {
        throw new Error('No matching asset');
      }

      downloadLink.href = asset.browser_download_url;
      downloadLink.removeAttribute('target');
      downloadLink.removeAttribute('rel');
      downloadLink.setAttribute('download', '');
      downloadLink.setAttribute('data-download-asset', asset.name);
    })
    .catch(() => {
      downloadLink.href = releasesUrl;
    })
    .finally(() => {
      downloadLink.removeAttribute('aria-busy');
      if (!downloadLink.textContent || downloadLink.textContent !== originalLabel) {
        downloadLink.textContent = originalLabel;
      }
    });

  function pickAsset(assets) {
    if (!Array.isArray(assets)) {
      return null;
    }

    const filtered = assets.filter((asset) => {
      if (!asset || typeof asset.name !== 'string') {
        return false;
      }
      if (typeof asset.browser_download_url !== 'string') {
        return false;
      }
      return !/\.(blockmap|yml|yaml)$/i.test(asset.name);
    });

    return filtered.find((asset) => /mac\.zip$/i.test(asset.name)) || null;
  }
})();
