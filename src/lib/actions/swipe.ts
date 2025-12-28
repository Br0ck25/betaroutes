export function swipeable(node: HTMLElement, { onEdit, onDelete }: { onEdit: () => void, onDelete: () => void }) {
    let startX = 0;
    let startY = 0;
    let x = 0;
    let swiping = false;

    function handleTouchStart(e: TouchEvent) {
        const touch = e.touches?.[0];
        if (!touch) return;
        startX = touch.clientX;
        startY = touch.clientY;
        x = 0;
        node.style.transition = 'none';
    }

    function handleTouchMove(e: TouchEvent) {
        const touch = e.touches?.[0];
        if (!touch) return;
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dy) > Math.abs(dx)) return;
        swiping = true;
        if (dx < -120) x = -120;
        else if (dx > 120) x = 120;
        else x = dx;
        node.style.transform = `translateX(${x}px)`;
        if (Math.abs(x) > 10) e.preventDefault();
    }

    function handleTouchEnd() {
        if (!swiping) return;
        swiping = false;
        node.style.transition = 'transform 0.2s ease-out';
        if (x < -80) {
            onDelete();
        } else if (x > 80) {
            onEdit();
        }
        node.style.transform = 'translateX(0)';
    }

    function handleClick(e: MouseEvent) {
        if (Math.abs(x) > 10) {
            e.stopPropagation();
            e.preventDefault();
        }
    }

    node.addEventListener('touchstart', handleTouchStart, { passive: false });
    node.addEventListener('touchmove', handleTouchMove, { passive: false });
    node.addEventListener('touchend', handleTouchEnd);
    node.addEventListener('click', handleClick, { capture: true });

    return {
        destroy() {
            node.removeEventListener('touchstart', handleTouchStart);
            node.removeEventListener('touchmove', handleTouchMove);
            node.removeEventListener('touchend', handleTouchEnd);
            node.removeEventListener('click', handleClick);
        }
    };
}