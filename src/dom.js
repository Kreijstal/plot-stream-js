/**
 * DOM manipulation, SVG creation, and ResizeObserver handling for StreamingChart.
 */

/**
 * Calculates the drawing dimensions based on the container size and margins.
 * @param {HTMLElement} targetElement - The container element.
 * @param {object} margin - The margin configuration object.
 * @returns {object} - { width, height, containerWidth, containerHeight }
 */
function calculateDimensions(targetElement, margin) {
    // Use clientWidth/Height for content size, excluding borders/padding
    const containerWidth = targetElement.clientWidth;
    const containerHeight = targetElement.clientHeight;

    let width = containerWidth - margin.left - margin.right;
    let height = containerHeight - margin.top - margin.bottom;

    // Ensure width/height are not negative
    width = Math.max(10, width);
    height = Math.max(10, height);

    return { width, height, containerWidth, containerHeight };
}

/**
 * Creates the main SVG structure within the target element.
 * @param {object} d3 - The D3 library object.
 * @param {HTMLElement} targetElement - The container element.
 * @param {number} svgWidth - The total SVG width (drawing area + margins).
 * @param {number} svgHeight - The total SVG height (drawing area + margins).
 * @param {string} clipPathId - The unique ID for the clipping path.
 * @param {object} margin - The margin configuration object.
 * @returns {object} - An object containing D3 selections for key SVG elements:
 *                     { svg, mainGroup, xAxisGroup, yAxisGroup, gridXGroup, gridYGroup, linesGroup, legendGroup, zoomOverlay }
 */
function createSVGStructure(d3, targetElement, svgWidth, svgHeight, clipPathId, margin) {
    const svg = d3.select(targetElement)
        .append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight)
        .style("display", "block"); // Prevent extra space below SVG

    // Clipping path
    svg.append("defs")
        .append("clipPath")
        .attr("id", clipPathId)
        .append("rect") // Width/height set during resize/initialization
        .attr("width", 0)
        .attr("height", 0);

    const mainGroup = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Grid Lines (behind data)
    const gridXGroup = mainGroup.append("g").attr("class", "grid grid-x");
    const gridYGroup = mainGroup.append("g").attr("class", "grid grid-y");

    // Lines group with clipping
    const linesGroup = mainGroup.append("g")
        .attr("class", "lines-group")
        .attr("clip-path", `url(#${clipPathId})`);

    // Axes (on top of grid)
    const xAxisGroup = mainGroup.append("g").attr("class", "x-axis");
    const yAxisGroup = mainGroup.append("g").attr("class", "y-axis");

    // Legend Group (appended to SVG for positioning outside main group)
    const legendGroup = svg.append("g").attr("class", "legend");

    // Zoom overlay rect for event capture
    const zoomOverlay = mainGroup.append("rect")
        .attr("class", "zoom-overlay")
        .style("fill", "none")
        .style("pointer-events", "all"); // Width/height set later

    return { svg, mainGroup, xAxisGroup, yAxisGroup, gridXGroup, gridYGroup, linesGroup, legendGroup, zoomOverlay };
}

/**
 * Adds axis labels to the chart.
 * @param {object} mainGroup - The D3 selection of the main chart group.
 * @param {object} config - The chart configuration.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @param {object} margin - The margin configuration object.
 */
function addAxisLabels(mainGroup, config, width, height, margin) {
    // X Axis Label
    mainGroup.append("text")
        .attr("class", "x-axis-label")
        .attr("text-anchor", "middle")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 5) // Adjust position
        .text(config.xAxis.label || "");

    // Y Axis Label
    mainGroup.append("text")
        .attr("class", "y-axis-label")
        .attr("text-anchor", "middle")
        .attr("transform", `rotate(-90)`)
        .attr("x", -height / 2)
        .attr("y", -margin.left + 15) // Adjust position
        .text(config.yAxis.label || "");
}

/**
 * Updates the text content of axis labels.
 * @param {object} mainGroup - The D3 selection of the main chart group.
 * @param {object} config - The chart configuration.
 */
function updateAxisLabelsText(mainGroup, config) {
     mainGroup.select(".x-axis-label").text(config.xAxis.label || "");
     mainGroup.select(".y-axis-label").text(config.yAxis.label || "");
}


/**
 * Sets up the ResizeObserver to handle container resizing.
 * @param {HTMLElement} targetElement - The container element to observe.
 * @param {function} onResize - The callback function to execute on resize.
 * @returns {ResizeObserver} - The configured ResizeObserver instance.
 */
function setupResizeObserver(targetElement, onResize) {
    const resizeObserver = new ResizeObserver(entries => {
        // Basic debounce/throttle could be added here if needed
        onResize(); // Call the handler passed from the chart instance
    });
    resizeObserver.observe(targetElement);
    return resizeObserver;
}

/**
 * Handles the resize event, updating dimensions, scales, and redrawing.
 * This function is intended to be bound to the chart instance (`this`) when called.
 * @param {object} elements - Object containing D3 selections { svg, mainGroup, zoomOverlay }.
 * @param {string} clipPathId - The unique ID for the clipping path.
 * @param {object} margin - The margin configuration object.
 * @param {function} calculateAndUpdateDimensions - Function to recalc width/height.
 * @param {function} updateScaleRanges - Function to update scale ranges.
 * @param {function} updateZoomExtents - Function to update zoom behavior extents.
 * @param {function} updateLegendPosition - Function to update legend position.
 * @param {function} redrawChart - Function to trigger a full redraw.
 */
function handleResize(elements, clipPathId, margin, calculateAndUpdateDimensions, updateScaleRanges, updateZoomExtents, updateLegendPosition, redrawChart) {

    const { newWidth, newHeight, newContainerWidth, newContainerHeight } = calculateAndUpdateDimensions();

    const { svg, mainGroup, zoomOverlay } = elements;

    // Update SVG size
    svg.attr("width", newWidth + margin.left + margin.right)
       .attr("height", newHeight + margin.top + margin.bottom);

    // Update main group translation (usually fixed, but good practice)
    mainGroup.attr("transform", `translate(${margin.left},${margin.top})`);

    // Update clip path size
    svg.select(`#${clipPathId} rect`)
        .attr("width", newWidth)
        .attr("height", newHeight);

    // Update zoom overlay size
    zoomOverlay
        .attr("width", newWidth)
        .attr("height", newHeight);

    // Update axis label positions
     mainGroup.select(".x-axis-label")
         .attr("x", newWidth / 2)
         .attr("y", newHeight + margin.bottom - 5);
     mainGroup.select(".y-axis-label")
         .attr("x", -newHeight / 2)
         .attr("y", -margin.left + 15);

    // Update scale ranges
    updateScaleRanges(newWidth, newHeight);

    // Update zoom extent and translation limits
    updateZoomExtents(newWidth, newHeight);

    // Update legend position
    updateLegendPosition();

    // Full redraw needed as scales/axes/lines change
    redrawChart();
}

/**
 * Removes the SVG element and disconnects the observer.
 * @param {object} svg - The D3 selection of the SVG element.
 * @param {ResizeObserver} resizeObserver - The ResizeObserver instance.
 */
function cleanupDOM(svg, resizeObserver) {
    if (resizeObserver) {
        resizeObserver.disconnect();
    }
    if (svg) {
        svg.remove();
    }
}

/**
 * Creates a follow button SVG element.
 * @param {object} svg - The D3 selection of the SVG element.
 * @param {function} onClick - The click handler function.
 * @returns {object} - D3 selection of the button group.
 */
function createFollowButton(svg, onClick) {
    const buttonGroup = svg.append("g")
        .attr("class", "follow-button")
        .style("cursor", "pointer")
        .on("click", onClick);

    // Simple button appearance: rect + text
    buttonGroup.append("rect")
        .attr("rx", 3)
        .attr("ry", 3)
        .attr("fill", "#f0f0f0")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 1);

    buttonGroup.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .style("font-size", "10px")
        .style("user-select", "none")
        .text("Follow: ON");

    // Initial update of size
    updateFollowButtonAppearance(buttonGroup, true);

    return buttonGroup;
}

/**
 * Updates the follow button's text and size.
 * @param {object} buttonGroup - D3 selection of the button group.
 * @param {boolean} isFollowing - Current follow state.
 */
function updateFollowButtonAppearance(buttonGroup, isFollowing) {
    if (!buttonGroup || buttonGroup.empty()) return;

    const textElement = buttonGroup.select("text");
    const rectElement = buttonGroup.select("rect");
    const padding = { x: 8, y: 4 };

    textElement.text(isFollowing ? "Follow: ON" : "Follow: OFF");

    // Recalculate size based on new text
    const textBBox = textElement.node()?.getBBox() || { width: 50, height: 12 };
    const rectWidth = textBBox.width + 2 * padding.x;
    const rectHeight = textBBox.height + 2 * padding.y;

    rectElement
        .attr("width", rectWidth)
        .attr("height", rectHeight);

    // Center text within the rect
    textElement
        .attr("x", rectWidth / 2)
        .attr("y", rectHeight / 2);
}

/**
 * Calculates the position for the follow button.
 * @param {object} buttonGroup - D3 selection of the button group.
 * @param {object} margin - The margin configuration object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @returns {string} - The transform string for positioning.
 */
function getFollowButtonPosition(buttonGroup, margin, width, height) {
    const buttonBBox = buttonGroup?.node()?.getBBox() || { width: 0, height: 0 };
    const x = margin.left + width - buttonBBox.width - 10;
    const y = margin.top + 10;

    return `translate(${x}, ${y})`;
}

/**
 * Handles the resize event, updating dimensions, scales, and redrawing.
 * @param {object} elements - Object containing D3 selections { svg, mainGroup, zoomOverlay }.
 * @param {string} clipPathId - The unique ID for the clipping path.
 * @param {object} margin - The margin configuration object.
 * @param {function} calculateAndUpdateDimensions - Function to recalc width/height.
 * @param {function} updateScaleRanges - Function to update scale ranges.
 * @param {function} updateZoomExtents - Function to update zoom behavior extents.
 * @param {function} updateOverlayPositions - Function to update positions of overlays like legend, buttons.
 * @param {function} redrawChart - Function to trigger a full redraw.
 */
function handleResize(elements, clipPathId, margin, calculateAndUpdateDimensions, updateScaleRanges, updateZoomExtents, updateOverlayPositions, redrawChart) {
    const { newWidth, newHeight, newContainerWidth, newContainerHeight } = calculateAndUpdateDimensions();

    const { svg, mainGroup, zoomOverlay } = elements;

    svg.attr("width", newWidth + margin.left + margin.right)
       .attr("height", newHeight + margin.top + margin.bottom);
    mainGroup.attr("transform", `translate(${margin.left},${margin.top})`);
    svg.select(`#${clipPathId} rect`)
        .attr("width", newWidth)
        .attr("height", newHeight);
    zoomOverlay
        .attr("width", newWidth)
        .attr("height", newHeight);

    mainGroup.select(".x-axis-label")
        .attr("x", newWidth / 2)
        .attr("y", newHeight + margin.bottom - 5);
    mainGroup.select(".y-axis-label")
        .attr("x", -newHeight / 2)
        .attr("y", -margin.left + 15);

    updateScaleRanges(newWidth, newHeight);
    updateZoomExtents(newWidth, newHeight);
    updateOverlayPositions();
    redrawChart();
}


module.exports = {
    calculateDimensions,
    createSVGStructure,
    addAxisLabels,
    updateAxisLabelsText,
    setupResizeObserver,
    handleResize,
    cleanupDOM
};