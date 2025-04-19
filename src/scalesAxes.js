/**
 * D3 Scale and Axis management for StreamingChart.
 */

/**
 * Initializes D3 scales.
 * @param {object} d3 - The D3 library object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @returns {object} - An object containing initialized xScale and yScale.
 */
function initializeScales(d3, width, height) {
    const xScale = d3.scaleLinear().range([0, width]);
    const yScale = d3.scaleLinear().range([height, 0]);
    return { xScale, yScale };
}

/**
 * Initializes D3 axes.
 * @param {object} d3 - The D3 library object.
 * @param {object} scales - Object containing xScale and yScale.
 * @returns {object} - An object containing initialized xAxis and yAxis generators.
 */
function initializeAxes(d3, scales) {
    const xAxis = d3.axisBottom(scales.xScale).tickSizeOuter(0);
    const yAxis = d3.axisLeft(scales.yScale).tickSizeOuter(0);
    return { xAxis, yAxis };
}

/**
 * Calculates the full X domain based on all data points across all series.
 * @param {object} d3 - The D3 library object.
 * @param {object} dataStore - The main data store.
 * @returns {Array<number>} - [minX, maxX] or a default range if no data.
 */
function getFullXDomain(d3, dataStore) {
    let allX = [];
    for (const seriesId in dataStore) {
        allX = allX.concat(dataStore[seriesId].map((p) => p.x));
    }
    let [minX, maxX] = d3.extent(allX);

    if (minX === undefined) return [0, 1]; // Default if no data
    if (minX === maxX) return [minX - 1, maxX + 1]; // Add padding for single point
    return [minX, maxX];
}

/**
 * Calculates the full Y domain based on all data points across all series.
 * Adds padding.
 * @param {object} d3 - The D3 library object.
 * @param {object} dataStore - The main data store.
 * @returns {Array<number>} - [minY, maxY] or a default range if no data.
 */
function getFullYDomain(d3, dataStore) {
    let allY = [];
    for (const seriesId in dataStore) {
        allY = allY.concat(
            dataStore[seriesId]
                .map((p) => p.y)
                .filter((y) => y !== null && !isNaN(y)) // Filter out null/NaN
        );
    }
    let [minY, maxY] = d3.extent(allY);

    if (minY === undefined) return [0, 1]; // Default if no data

    // Add padding
    if (minY === maxY) {
        minY -= Math.abs(minY * 0.1) || 0.5; // Add 10% padding or 0.5
        maxY += Math.abs(maxY * 0.1) || 0.5;
    } else {
        const padding = (maxY - minY) * 0.05 || 0.5; // 5% padding or 0.5
        minY -= padding;
        maxY += padding;
    }

     // Ensure min < max after padding
     if (minY >= maxY) {
        minY = maxY - 1; // Ensure there's always a range
    }

    return [minY, maxY];
}


/**
 * Calculates the target X domain based on config and data.
 * @param {object} d3 - The D3 library object.
 * @param {object} config - The chart configuration.
 * @param {object} xScale - The current D3 xScale instance (unused).
 * @param {object} dataStore - The main data store.
 * @returns {Array<number>} - The calculated [minX, maxX] domain.
 */
function calculateXDomain(d3, config, xScale, dataStore) {
    const configRange = config.xAxis.range;

    // Priority 1: Explicit fixed range in config
    if (
        configRange &&
        typeof configRange.min === "number" &&
        typeof configRange.max === "number"
    ) {
        // Ensure min < max
        return configRange.min < configRange.max ?
            [configRange.min, configRange.max] :
            [configRange.min, configRange.min + 1];
    }

    // Priority 2: Calculate from full data extent
    const fullDataX = getFullXDomain(d3, dataStore);
    let [minX, maxX] = fullDataX; // getFullXDomain handles no/single data point padding

    // Apply explicit config bounds individually if they exist
    if (configRange) {
        if (typeof configRange.min === "number") {
            minX = configRange.min;
        }
        if (typeof configRange.max === "number") {
            maxX = configRange.max;
        }
    }

    // Final check: Ensure min < max after applying constraints
    if (minX >= maxX) {
        // If bounds came from config, respect them but ensure range > 0
        if (typeof configRange?.min === 'number' && typeof configRange?.max === 'number') {
             return [configRange.min, configRange.min + 1];
        }
        // If derived from data or single bound, add padding
        return [minX - 1, maxX + 1];
    }
    return [minX, maxX];
}

/**
 * Calculates the target Y domain considering config and VISIBLE data within the currentXDomain.
 * @param {object} d3 - The D3 library object.
 * @param {object} config - The chart configuration.
 * @param {object} dataStore - The main data store.
 * @param {Array<number>} currentXDomain - The current [minX, maxX] domain of the X-axis.
 * @returns {Array<number>} - The calculated [minY, maxY] domain.
 */
function calculateYDomain(d3, config, dataStore, currentXDomain) {
    const configRange = config.yAxis.range;

    // Priority 1: Fixed config range
    if (
        configRange &&
        typeof configRange.min === "number" &&
        typeof configRange.max === "number"
    ) {
        return [configRange.min, configRange.max];
    }

    // Priority 2: Auto-scale based on visible data
    let visibleY = [];
    for (const seriesId in dataStore) {
        dataStore[seriesId].forEach((p) => {
            if (
                p.x >= currentXDomain[0] &&
                p.x <= currentXDomain[1] &&
                p.y !== null &&
                !isNaN(p.y)
            ) {
                visibleY.push(p.y);
            }
        });
    }

    let [minY, maxY] = d3.extent(visibleY);

    // Handle no visible data
    if (minY === undefined) {
        minY = configRange && typeof configRange.min === "number" ? configRange.min : 0;
        maxY = configRange && typeof configRange.max === "number" ? configRange.max : 1;
        if (minY === maxY) return [minY - 0.5, maxY + 0.5];
        return [minY, maxY];
    }

    // Apply individual config limits if auto-scaling
    minY = configRange && typeof configRange.min === "number" ? configRange.min : minY;
    maxY = configRange && typeof configRange.max === "number" ? configRange.max : maxY;

    // Add padding
    if (minY === maxY) {
        minY -= Math.abs(minY * 0.1) || 0.5; // Add 10% padding or 0.5
        maxY += Math.abs(maxY * 0.1) || 0.5;
    } else {
        const padding = (maxY - minY) * 0.05 || 0.5; // 5% padding or 0.5
        minY -= padding;
        maxY += padding;
    }

     // Ensure min < max after padding
     if (minY >= maxY) {
        minY = maxY - 1; // Ensure there's always a range
    }

    return [minY, maxY];
}

/**
 * Updates the domains of the scales based on calculated domains.
 * @param {object} d3 - The D3 library object.
 * @param {object} config - The chart configuration.
 * @param {object} scales - Object containing xScale and yScale.
 * @param {object} dataStore - The main data store.
 */
function updateScaleDomains(d3, config, scales, dataStore) {
    const xDomain = calculateXDomain(d3, config, scales.xScale, dataStore);
    const yDomain = calculateYDomain(d3, config, dataStore, xDomain); // Y domain depends on visible X

    scales.xScale.domain(xDomain);
    scales.yScale.domain(yDomain);
}

/**
 * Updates the visual representation of the axes.
 * @param {object} axesElements - Object containing D3 selections for axis groups (xAxisGroup, yAxisGroup).
 * @param {object} axesGenerators - Object containing D3 axis generators (xAxis, yAxis).
 * @param {object} scales - Object containing xScale and yScale.
 * @param {number} height - The chart drawing area height.
 * @param {boolean} [animate=false] - Whether to animate the update.
 * @param {object} [transition=null] - Optional D3 transition object.
 */
function updateAxes(axesElements, axesGenerators, scales, height, animate = false, transition = null) {
    const { xAxisGroup, yAxisGroup } = axesElements;
    const { xAxis, yAxis } = axesGenerators;

    // Use provided transition or select the group directly
    const xTarget = animate && transition ? xAxisGroup.transition(transition) : xAxisGroup;
    const yTarget = animate && transition ? yAxisGroup.transition(transition) : yAxisGroup;

    xTarget
        .call(xAxis.scale(scales.xScale)) // Ensure scale is up-to-date
        .attr("transform", `translate(0,${height})`); // Keep position updated

    yTarget.call(yAxis.scale(scales.yScale)); // Ensure scale is up-to-date
}


module.exports = {
    initializeScales,
    initializeAxes,
    getFullXDomain,
    getFullYDomain,
    calculateXDomain,
    calculateYDomain,
    updateScaleDomains,
    updateAxes
};