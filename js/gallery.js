const galleryState = {
    items: [],
    visibleItems: [],
    activeFilter: 'All',
    activeIndex: 0,
};

const galleryGrid = document.querySelector('#gallery-grid');
const galleryCount = document.querySelector('#gallery-count');
const lightbox = document.querySelector('#gallery-lightbox');
const lightboxMedia = document.querySelector('#lightbox-media');
const lightboxTitle = document.querySelector('#lightbox-title');
const lightboxCategory = document.querySelector('#lightbox-category');
const lightboxPosition = document.querySelector('#lightbox-position');

function createGalleryItem(item) {
    const section = item.section || item.category;
    const button = document.createElement('button');
    button.className = 'gallery-item';
    button.type = 'button';
    button.dataset.galleryId = item.id;
    button.dataset.category = item.category;
    button.dataset.layout = item.layout;
    button.setAttribute('aria-label', `Open ${item.title}`);

    const image = document.createElement('img');
    image.src = item.thumb;
    image.alt = item.alt;
    image.loading = item.order < 6 ? 'eager' : 'lazy';
    image.decoding = 'async';
    button.append(image);

    if (item.type === 'video') {
        const badge = document.createElement('span');
        badge.className = 'gallery-video-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = '▶';
        button.append(badge);
    }

    const meta = document.createElement('span');
    meta.className = 'gallery-item-meta';
    const category = document.createElement('span');
    category.textContent = section;
    const title = document.createElement('strong');
    title.textContent = item.title;
    meta.append(category, title);
    button.append(meta);

    button.addEventListener('click', () => openLightbox(item.id));
    return button;
}

function renderGallery() {
    const fragment = document.createDocumentFragment();
    galleryState.items.forEach(item => fragment.append(createGalleryItem(item)));
    galleryGrid.replaceChildren(fragment);
    applyFilter('All');
}

function applyFilter(filter) {
    galleryState.activeFilter = filter;
    galleryState.visibleItems = galleryState.items.filter(item => filter === 'All' || item.category === filter);

    document.querySelectorAll('.gallery-item').forEach(item => {
        item.hidden = filter !== 'All' && item.dataset.category !== filter;
    });

    document.querySelectorAll('.gallery-filter').forEach(button => {
        const isActive = button.dataset.galleryFilter === filter;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });

    galleryCount.textContent = `${galleryState.visibleItems.length} ${galleryState.visibleItems.length === 1 ? 'moment' : 'moments'}`;
}

function showLightboxItem(index) {
    const itemCount = galleryState.visibleItems.length;
    galleryState.activeIndex = (index + itemCount) % itemCount;
    const item = galleryState.visibleItems[galleryState.activeIndex];

    let media;
    if (item.type === 'video') {
        media = document.createElement('video');
        media.src = item.src;
        media.poster = item.poster;
        media.controls = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.setAttribute('aria-label', item.alt);
    } else {
        media = document.createElement('img');
        media.src = item.src;
        media.alt = item.alt;
    }

    lightboxMedia.replaceChildren(media);
    lightboxTitle.textContent = item.title;
    lightboxCategory.textContent = item.section || item.category;
    lightboxPosition.textContent = `${galleryState.activeIndex + 1} / ${itemCount}`;
}

function openLightbox(id) {
    const index = galleryState.visibleItems.findIndex(item => item.id === id);
    if (index < 0) {
        return;
    }

    showLightboxItem(index);
    document.body.classList.add('gallery-viewer-open');
    lightbox.showModal();
}

function closeLightbox() {
    const video = lightboxMedia.querySelector('video');
    if (video) {
        video.pause();
    }
    lightbox.close();
}

document.querySelectorAll('.gallery-filter').forEach(button => {
    button.addEventListener('click', () => applyFilter(button.dataset.galleryFilter));
});

document.querySelector('.gallery-lightbox-close').addEventListener('click', closeLightbox);
document.querySelector('.gallery-lightbox-prev').addEventListener('click', () => showLightboxItem(galleryState.activeIndex - 1));
document.querySelector('.gallery-lightbox-next').addEventListener('click', () => showLightboxItem(galleryState.activeIndex + 1));

lightbox.addEventListener('click', event => {
    if (event.target === lightbox) {
        closeLightbox();
    }
});

lightbox.addEventListener('close', () => {
    document.body.classList.remove('gallery-viewer-open');
    lightboxMedia.replaceChildren();
});

document.addEventListener('keydown', event => {
    if (!lightbox.open) {
        return;
    }
    if (event.key === 'ArrowLeft') {
        showLightboxItem(galleryState.activeIndex - 1);
    } else if (event.key === 'ArrowRight') {
        showLightboxItem(galleryState.activeIndex + 1);
    }
});

fetch('data/gallery.json?v=20260713-2', { cache: 'no-store' })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Gallery data request failed: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        galleryState.items = data.items;
        renderGallery();
    })
    .catch(error => {
        galleryGrid.innerHTML = '<p class="gallery-error">The gallery could not be loaded.</p>';
        console.error(error);
    });
