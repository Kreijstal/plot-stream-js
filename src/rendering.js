/**
 * SVG Rendering functions for StreamingChart (lines, grid, legend).
 */

/**
 * Initializes the D3 line generator.
 * @param {object} d3 - The D3 library object.
 * @param {object} scales - Object containing xScale and yScale.
 * @returns {object} - The configured D3 line generator.
 */
function initializeLineGenerator(d3, scales) {
    return d3.line()
        // .defined(d => d !== null && d.y !== null && !isNaN(d.y)) // Optional: handle gaps explicitly
        .x((d) => scales.xScale(d.x))
        .y((d) => scales.yScale(d.y));
}

/**
 * Updates the grid lines based on the current scales and configuration.
 * @param {object} d3 - The D3 library object.
 * @param {object} gridGroups - Object containing D3 selections for grid groups (gridXGroup, gridYGroup).
 * @param {object} scales - Object containing xScale and yScale.
 * @param {object} config - The chart configuration.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 */
function updateGridLines(d3, gridGroups, scales, config, width, height) {
    const { gridXGroup, gridYGroup } = gridGroups;
    const { xScale, yScale } = scales;

    // X Grid Lines (vertical)
    gridXGroup
        .style("display", config.yAxis.showGridLines ? null : "none") // Controlled by Y-axis config
        .attr("transform", `translate(0,${height})`) // Keep position updated
        .call(
            d3.axisBottom(xScale)
                .tickSize(-height) // Lines go up
                .tickFormat("") // No labels on grid lines
        );
    // Style grid lines
    gridXGroup.select(".domain").remove();
    gridXGroup.selectAll("line").attr("stroke", "#e0e0e0").attr("stroke-opacity", 0.7);
    gridXGroup.selectAll("text").remove(); // Ensure no text labels

    // Y Grid Lines (horizontal)
    gridYGroup
        .style("display", config.xAxis.showGridLines ? null : "none") // Controlled by X-axis config
        .call(
            d3.axisLeft(yScale)
                .tickSize(-width) // Lines go right
                .tickFormat("")
        );
    // Style grid lines
    gridYGroup.select(".domain").remove();
    gridYGroup.selectAll("line").attr("stroke", "#e0e0e0").attr("stroke-opacity", 0.7);
    gridYGroup.selectAll("text").remove();
}

/**
 * Updates the data lines (paths) on the chart.
 * @param {object} linesGroup - The D3 selection of the group containing the lines.
 * @param {object} dataStore - The main data store.
 * @param {object} seriesConfigs - The series configuration object.
 * @param {object} lineGenerator - The D3 line generator instance.
 * @param {boolean} [animate=false] - Whether to animate the update.
 * @param {object} [transition=null] - Optional D3 transition object.
 */
function updateLines(linesGroup, dataStore, seriesConfigs, lineGenerator, animate = false, transition = null) {
    const seriesEntries = Object.entries(dataStore);

    const lines = linesGroup
        .selectAll(".series-line")
        .data(seriesEntries, (d) => d[0]); // Key by seriesId: [seriesId, pointsArray]

    const linesEnter = lines.enter()
        .append("path")
        .attr("class", "series-line")
        .attr("fill", "none")
        .attr("stroke", (d) => seriesConfigs[d[0]]?.color || "#000")
        .attr("stroke-width", (d) => seriesConfigs[d[0]]?.lineWidth || 1.5)
        .attr("stroke-linejoin", "round")
        .attr("stroke-linecap", "round");

    const linesUpdate = lines.merge(linesEnter); // Apply updates to both entering and updating elements

    // Apply transition if specified
    const targetUpdate = animate && transition ? linesUpdate.transition(transition) : linesUpdate;

    targetUpdate
        .attr("d", (d) => lineGenerator(d[1])) // d[1] is the array of points
        .attr("stroke", (d) => seriesConfigs[d[0]]?.color || "#000") // Update color if changed
        .attr("stroke-width", (d) => seriesConfigs[d[0]]?.lineWidth || 1.5); // Update width if changed

    // Apply exit transition if specified
    const linesExit = lines.exit();
    const targetExit = animate && transition ? linesExit.transition(transition) : linesExit;
    targetExit.remove();
}


/**
 * Calculates the translation for the legend group based on config and bounding box.
 * @param {object} legendGroupNode - The DOM node of the legend group.
 * @param {object} config - The chart configuration.
 * @param {object} margin - The chart margin object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 * @returns {string} - The transform attribute string (e.g., "translate(x, y)").
 */
function getLegendPosition(legendGroupNode, config, margin, width, height) {
    const legendBBox = legendGroupNode?.getBBox() || { width: 0, height: 0 };
    const position = config.legend.position;
    let x = margin.left + 10; // Default top-left with padding
    let y = margin.top + 10;

    switch (position) {
        case "top-right":
            x = margin.left + width - legendBBox.width - 10; // 10px padding from right edge
            y = margin.top + 10; // 10px padding from top
            break;
        case "bottom-left":
            x = margin.left + 10;
            y = margin.top + height - legendBBox.height - 10;
            break;
        case "bottom-right":
            x = margin.left + width - legendBBox.width - 10;
            y = margin.top + height - legendBBox.height - 10;
            break;
        // case "top-left": // Default already handled
        // default:
        //     break; // Use default x, y
    }
    // Ensure legend doesn't go off-screen (simple bounds check)
    x = Math.max(margin.left, Math.min(x, margin.left + width - legendBBox.width));
    y = Math.max(margin.top, Math.min(y, margin.top + height - legendBBox.height));

    return `translate(${x}, ${y})`;
}


/**
 * Updates the legend display based on current series configurations.
 * @param {object} legendGroup - The D3 selection of the legend group.
 * @param {object} seriesConfigs - The series configuration object.
 * @param {object} config - The chart configuration.
 * @param {object} margin - The chart margin object.
 * @param {number} width - The chart drawing area width.
 * @param {number} height - The chart drawing area height.
 */
function updateLegend(legendGroup, seriesConfigs, config, margin, width, height) {
    if (!config.legend.visible) {
        legendGroup.selectAll("*").remove(); // Clear legend if not visible
        return;
    }

    const legendItems = Object.entries(seriesConfigs); // Use configs as source of truth

    const itemHeight = 20;
    const itemPadding = 5;
    const symbolSize = 10;

    const legend = legendGroup
        .selectAll(".legend-item")
        .data(legendItems, (d) => d[0]); // Key by seriesId [seriesId, configObject]

    const legendEnter = legend.enter()
        .append("g")
        .attr("class", "legend-item");
        // Position is set in merge below

    // Add color symbol (rectangle for line charts)
    legendEnter.append("rect")
        .attr("width", symbolSize)
        .attr("height", symbolSize)
        .attr("y", (itemHeight - symbolSize) / 2 - itemPadding / 2) // Center vertically slightly adjusted
        .attr("fill", (d) => d[1].color || "#000"); // d[1] is the config object

    // Add text label
    legendEnter.append("text")
        .attr("x", symbolSize + itemPadding)
        .attr("y", itemHeight / 2) // Center text vertically
        .attr("dy", "0.35em") // Vertical alignment adjustment
        .style("font-size", "10px")
        .style("fill", "#333")
        .text((d) => d[1].label || d[0]); // Use label or fallback to ID

    // --- Update existing items ---
    const legendUpdate = legend.merge(legendEnter);

    legendUpdate.select("rect")
        .attr("fill", (d) => d[1].color || "#000"); // Update color if changed

    legendUpdate.select("text")
        .text((d) => d[1].label || d[0]); // Update label if changed

    // Update position for all items (including entering)
    legendUpdate.attr("transform", (d, i) => `translate(0, ${i * itemHeight})`);

    legend.exit().remove();

    // Adjust legend group position dynamically after items are potentially added/removed/updated
    legendGroup.attr("transform", getLegendPosition(legendGroup.node(), config, margin, width, height));
}


module.exports = {
    initializeLineGenerator,
    updateGridLines,
    updateLines,
    updateLegend,
    getLegendPosition // Exporting for potential direct use if needed
};