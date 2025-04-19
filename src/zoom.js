/**
 * D3 Zoom and Pan handling for StreamingChart.
 */

/**
 * Initializes the D3 zoom behavior.
 * @param {object} d3 - The D3 library object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @param {function} onZoom - The callback function to execute when a zoom event occurs.
 * @returns {object} - The configured D3 zoom behavior instance.
 */
function initializeZoom(d3, width, height, onZoom) {
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 100]) // Example zoom limits
        .translateExtent([[0, 0], [width, height]]) // Limit panning within chart area
        .extent([[0, 0], [width, height]])
        .on("zoom", onZoom); // Attach the handler passed from the chart instance

    return zoomBehavior;
}

/**
 * Applies the zoom behavior to the target overlay element.
 * @param {object} zoomOverlay - The D3 selection of the zoom overlay rectangle.
 * @param {object} zoomBehavior - The configured D3 zoom behavior instance.
 * @param {boolean} enableZoom - Whether zooming/panning is currently enabled.
 */
function applyZoomBehavior(zoomOverlay, zoomBehavior, enableZoom) {
    if (enableZoom) {
        zoomOverlay
            .call(zoomBehavior)
            .on("dblclick.zoom", null); // Disable double-click reset if needed
    } else {
        zoomOverlay.on(".zoom", null); // Detach zoom behavior
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
        zoomBehavior
            .translateExtent([[0, 0], [width, height]])
            .extent([[0, 0], [width, height]]);
    }
}

/**
 * Handles the zoom event, updating scales and triggering redraws.
 * This function is intended to be bound to the chart instance (`this`) when called.
 * @param {object} event - The D3 zoom event object.
 * @param {object} d3 - The D3 library object.
 * @param {object} config - The chart configuration.
 * @param {object} scales - Object containing xScale and yScale.
 * @param {function} getFullXDomain - Function to get the full X data extent.
 * @param {function} getFullYDomain - Function to get the full Y data extent.
 * @param {function} redrawAxesAndGrid - Function to redraw axes and grid.
 * @param {function} redrawLines - Function to redraw data lines.
 * @returns {object} - The new zoom transform state.
 */
function handleZoom(event, d3, config, scales, getFullXDomain, getFullYDomain, redrawAxesAndGrid, redrawLines, previousTransform) { // Add previousTransform
    if (!config.interactions.zoom && !config.interactions.pan) return previousTransform; // Return previous if disabled

    const currentTransform = event.transform;
    let effectiveTransform = currentTransform; // Default to the event's transform

    // Check the source event type to differentiate drag vs. wheel
    const sourceEvent = event.sourceEvent;
    if (sourceEvent) {
        // If dragging (mousedown/touchstart followed by mousemove/touchmove)
        if (sourceEvent.type === 'mousemove' || sourceEvent.type === 'touchmove') {
             if (config.interactions.pan && !config.interactions.zoom) { // Only pan if zoom is disabled but pan is enabled (edge case)
                 effectiveTransform = d3.zoomIdentity.translate(currentTransform.x, currentTransform.y).scale(previousTransform.k);
             } else if (config.interactions.pan) { // If pan is generally enabled during drag
                 // Apply current translation but keep the previous scale
                 effectiveTransform = d3.zoomIdentity.translate(currentTransform.x, currentTransform.y).scale(previousTransform.k);
             } else {
                 // If panning is disabled, don't change anything
                 effectiveTransform = previousTransform;
             }
        }
        // If wheeling, effectiveTransform remains currentTransform (allows zoom)
        // unless zoom itself is disabled
        else if (sourceEvent.type === 'wheel' && !config.interactions.zoom) {
             effectiveTransform = previousTransform; // Don't zoom if zoom is disabled
        }
    }


    // Update scales based on the *effective* zoom transform
    // Rescale from the original full domain to avoid drift
    const fullX = getFullXDomain();
    const fullY = getFullYDomain();

    // Use the effectiveTransform for rescaling
    const newXScale = effectiveTransform.rescaleX(scales.xScale.copy().domain(fullX));
    const newYScale = effectiveTransform.rescaleY(scales.yScale.copy().domain(fullY));

    // Update the *actual* scales used for drawing
    scales.xScale.domain(newXScale.domain());
    scales.yScale.domain(newYScale.domain());

    // Redraw elements based on the updated scales
    redrawAxesAndGrid(); // Updates axes and grid lines
    redrawLines();       // Updates data lines

    // Return the *actual* transform from the event, so the state is correct for the *next* event
    return currentTransform;
}


module.exports = {
    initializeZoom,
    applyZoomBehavior,
    updateZoomExtents,
    handleZoom
};