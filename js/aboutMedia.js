function initializeScrollMedia() {
    const media = [...document.querySelectorAll('.scroll-grow-media')];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!media.length || reduceMotion) {
        return;
    }

    let frameRequested = false;

    function updateScale() {
        const viewportCenter = window.innerHeight / 2;
        const influence = window.innerHeight * 0.72;

        media.forEach(element => {
            const rect = element.getBoundingClientRect();
            const elementCenter = rect.top + (rect.height / 2);
            const proximity = Math.max(0, 1 - (Math.abs(elementCenter - viewportCenter) / influence));
            element.style.setProperty('--scroll-media-scale', (1.025 + (proximity * 0.085)).toFixed(4));
        });

        frameRequested = false;
    }

    function requestScaleUpdate() {
        if (!frameRequested) {
            frameRequested = true;
            window.requestAnimationFrame(updateScale);
        }
    }

    updateScale();
    window.addEventListener('scroll', requestScaleUpdate, { passive: true });
    window.addEventListener('resize', requestScaleUpdate);
}

document.addEventListener('DOMContentLoaded', initializeScrollMedia);
