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
 * @param {object} previousTransform - The previous D3 zoom transform state.
 * @param {number} width - The width of the chart drawing area.
 * @param {number} height - The height of the chart drawing area.
 * @returns {object} - The new zoom transform state.
 */
function handleZoom(event, d3, config, scales, getFullXDomain, getFullYDomain, redrawAxesAndGrid, redrawLines, previousTransform, width, height) { // Add width, height
    if (!previousTransform) previousTransform = d3.zoomIdentity; // Ensure previousTransform exists

    if (!config.interactions.zoom && !config.interactions.pan) return previousTransform;

    const currentTransform = event.transform;

    // Check the source event type
    const sourceEvent = event.sourceEvent;
    if (sourceEvent && (sourceEvent.type === 'mousemove' || sourceEvent.type === 'touchmove')) {
        // --- Dragging --- (Pan Only)
        if (config.interactions.pan) {
            // Construct a transform that ONLY includes the translation part of the current event,
            // but keeps the scale factor from the PREVIOUS state.
            const panOnlyTransform = d3.zoomIdentity
                .translate(currentTransform.x, currentTransform.y) // Apply current translation
                .scale(previousTransform.k); // Keep previous scale

            // Rescale using this pan-only transform
            const fullX = getFullXDomain();
            const fullY = getFullYDomain();
            // Use the panOnlyTransform for rescaling
            const newXScale = panOnlyTransform.rescaleX(scales.xScale.copy().domain(fullX));
            const newYScale = panOnlyTransform.rescaleY(scales.yScale.copy().domain(fullY));

            // Update the actual scales used for drawing
            scales.xScale.domain(newXScale.domain());
            scales.yScale.domain(newYScale.domain());

            // Redraw elements based on the updated scales
            redrawAxesAndGrid();
            redrawLines();

            // Return the panOnlyTransform to update d3's state correctly for the next event
            return panOnlyTransform;
        } else {
            // Panning disabled, return previous state without changes
            return previousTransform;
        }

    } else if (sourceEvent && sourceEvent.type === 'wheel') {
        // --- Scrolling --- (Zoom and Pan)
        if (config.interactions.zoom) {
            // Use standard rescale for zooming
            const fullX = getFullXDomain();
            const fullY = getFullYDomain();
            const newXScale = currentTransform.rescaleX(scales.xScale.copy().domain(fullX));
            const newYScale = currentTransform.rescaleY(scales.yScale.copy().domain(fullY));

            scales.xScale.domain(newXScale.domain());
            scales.yScale.domain(newYScale.domain());

            redrawAxesAndGrid();
            redrawLines();

            return currentTransform; // Return the full transform including scale change
        } else {
            // Zooming disabled, return previous state
            return previousTransform;
        }
    } else {
         // Other event types or no source event, likely programmatic transform or initial state
         // Apply the transform as is if needed (e.g., for setView)
         const fullX = getFullXDomain();
         const fullY = getFullYDomain();
         const newXScale = currentTransform.rescaleX(scales.xScale.copy().domain(fullX));
         const newYScale = currentTransform.rescaleY(scales.yScale.copy().domain(fullY));
         scales.xScale.domain(newXScale.domain());
         scales.yScale.domain(newYScale.domain());
         redrawAxesAndGrid();
         redrawLines();
         return currentTransform;
    }
}


module.exports = {
    initializeZoom,
    applyZoomBehavior,
    updateZoomExtents,
    handleZoom
};