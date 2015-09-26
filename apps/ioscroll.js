// iOS scroll taming based on http://www.hakoniemi.net/labs/scrollingOffset/nonbounce.html

(function () {
    'use strict';
    
    if (navigator.userAgent.match(/(iPad|iPhone|iPod)/)) {
        var scroller, clickable, startY, startX;
        
        document.ontouchstart = function (e) {
            var el = e.target;
            scroller = undefined;
            clickable = false;
            startY = e.touches ? e.touches[0].screenY : e.screenY;
            startX = e.touches ? e.touches[0].screenX : e.screenX;
            while (el && typeof el.hasAttribute === 'function') {
                if (el.hasAttribute('ui-scroller')) {
                    // Scrollable area
                    scroller = el;
                    return;
                } else if (el.hasAttribute('ng-click') || el.hasAttribute('ng-swipe-right') || el.hasAttribute('ng-swipe-left')
                           || el.hasAttribute('jqyoui-draggable') || el.tagName === 'INPUT' || el.tagName === 'LABEL'
                           || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.tagName === 'A') {
                    // Clickable or swipeable area
                    clickable = true;
                }
                el = el.parentNode;
            }
            if (!clickable) {
                // Other area
                e.preventDefault();
                return false;
            }
        };
        
        document.ontouchmove = function (e) {
            var y = e.touches ? e.touches[0].screenY : e.screenY,
                x = e.touches ? e.touches[0].screenX : e.screenX;
            if (scroller) {
                // Prevent elastic effect if scrollable area is already at the top or bottom, otherwise this causes a full page scroll.
                if (scroller.scrollTop === 0 && startY <= y) {
                    e.preventDefault();
                }
                if (scroller.scrollHeight - scroller.offsetHeight === scroller.scrollTop && startY >= y) {
                    e.preventDefault();
                }
            } else if (clickable) {
                // Allow horizontal swipe behavior but not vertical, which causes a full page scroll
                if (Math.abs(y - startY) > Math.abs(x - startX)) {
                    e.preventDefault();
                }
            } else {
                return false;
            }
        };

    }
    
}());