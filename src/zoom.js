/**
 * D3 Zoom and Pan handling utilities for StreamingChart.
 */

/**
 * Applies the zoom behavior to the target overlay element.
 * @param {object} zoomOverlay - The D3 selection of the zoom overlay rectangle.
 * @param {object} zoomBehavior - The configured D3 zoom behavior instance.
 * @param {boolean} enableZoom - Whether zooming is currently enabled.
 * @param {boolean} enablePan - Whether panning is currently enabled.
 */
function applyZoomBehavior(zoomOverlay, zoomBehavior, enableZoom, enablePan) {
    if (enableZoom || enablePan) {
        zoomOverlay.call(zoomBehavior);
        // Conditionally disable zoom or pan if needed (more complex)
        // For now, if either is enabled, enable the whole behavior.
        // We can filter events in the handler if necessary.
        zoomOverlay.style("cursor", enablePan ? "grab" : "default"); // Set cursor based on pan
        zoomOverlay.on("dblclick.zoom", null); // Keep double-click zoom disabled
    } else {
        zoomOverlay.on(".zoom", null); // Detach all zoom behavior listeners
        zoomOverlay.style("cursor", "default");
    }
}

/**
 * Updates the zoom behavior's extents when the chart resizes.
 * @param {object} zoomBehavior - The D3 zoom behavior instance.
 * @param {number} width - The new chart drawing area width.
 * @param {number} height - The new chart drawing area height.
 */
function updateZoomExtents(zoomBehavior, width, height) {
    if (zoomBehavior) {
        zoomBehavior.extent([[0, 0], [width, height]]);
    }
}

module.exports = {
    applyZoomBehavior,
    updateZoomExtents,
};