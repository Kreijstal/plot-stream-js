/**
 * Main StreamingChart class definition.
 * Orchestrates various modules for configuration, data, scales, rendering, DOM, and interactions.
 */

const { defaultConfig, deepMerge } = require('./config');
const { createColorScale, getColorForSeries } = require('./utils');
const { initSeriesConfigs, getDefaultSeriesConfig, pruneData, ensureSeriesExists, updateSeriesConfig: updateSeriesConfigInternal } = require('./data');
const { initializeScales, initializeAxes, getFullXDomain, getFullYDomain, calculateXDomain, calculateYDomain, updateScaleDomains, updateAxes } = require('./scalesAxes');
const { initializeLineGenerator, updateGridLines, updateLines, updateLegend, getLegendPosition } = require('./rendering');
const { initializeZoom, applyZoomBehavior, updateZoomExtents, handleZoom } = require('./zoom');
const {
    calculateDimensions, // Keep existing ones
    createSVGStructure,
    addAxisLabels,
    updateAxisLabelsText,
    setupResizeObserver,
    handleResize, // Use the correct name (it was likely handleResize before)
    cleanupDOM,
    // --- ADD THESE ---
    createFollowButton,
    updateFollowButtonAppearance, // Needed for the helper method
    getFollowButtonPosition       // Needed for the helper method
} = require('./dom');

class StreamingChart {
    // --- Private Instance Members ---

    // Configuration & State
    #d3; // Injected D3 library
    #config;
    #dataStore = {}; // { seriesId: [{x, y}, ...] }
    #seriesConfigs = {}; // Merged default/user configs per series
    #isDestroyed = false;
    #currentZoomTransform = null; // Initialized later if zoom is enabled

    // --- NEW State for Follow Button ---
    #isFollowing = true; // Start in follow mode by default
    #frozenXDomain = null; // Stores the X domain when follow is turned off
    #frozenYDomain = null; // Stores the Y domain when follow is turned off

    // --- NEW DOM Element for Follow Button ---
    #followButtonGroup = null; // D3 selection for the button group

    // --- NEW Method Declarations ---
    #onFollowButtonClick;
    #updateFollowButtonAppearance;
    #updateFollowButtonPosition;

    // Dimensions & Margins (Initialized if targetElement exists)
    #width;
    #height;
    #margin = { top: 30, right: 80, bottom: 40, left: 50 }; // Default margin

    // D3 Objects (Initialized if targetElement exists)
    #scales = { xScale: null, yScale: null };
    #axesGenerators = { xAxis: null, yAxis: null };
    #lineGenerator = null;
    #zoomBehavior = null;
    #colorScale = null;

    // DOM Elements (Initialized if targetElement exists)
    #targetElement = null;
    #svgElements = {
        svg: null, mainGroup: null, xAxisGroup: null, yAxisGroup: null,
        gridXGroup: null, gridYGroup: null, linesGroup: null, legendGroup: null,
        zoomOverlay: null
    };
    #clipPathId;
    #resizeObserver = null;


    /**
     * Creates a new streaming chart instance.
     * @param {object} d3 - The D3 library (v7 required).
     * @param {HTMLElement} [targetElement] - Optional container element for rendering.
     * @param {object} [initialConfig={}] - Initial configuration.
     */
    constructor(d3, targetElement, initialConfig = {}) {
        if (!d3) {
            throw new Error("D3 library instance (v7) is required.");
        }
        this.#d3 = d3;
        this.#currentZoomTransform = this.#d3.zoomIdentity; // Initialize zoom state

        // Config
        this.#config = deepMerge(defaultConfig, initialConfig);
        initSeriesConfigs(this.#config, this.#seriesConfigs);
        this.#colorScale = createColorScale(this.#d3); // Initialize color scale early

        // Assign initial colors if needed (for series defined in initialConfig without color)
        this.#assignInitialColors();

        // Unique ID for clipping
        this.#clipPathId = `clip-${Math.random().toString(36).substring(2, 15)}`;

        // DOM/SVG Initialization (only if targetElement is provided)
        if (targetElement) {
            if (!(targetElement instanceof HTMLElement)) {
                throw new Error("targetElement must be an HTMLElement if provided.");
            }
            this.#targetElement = targetElement;
            this.#initializeChartDOM();
            // --- NEW: Create the follow button ---
            this.#followButtonGroup = createFollowButton(this.#svgElements.svg, this.#onFollowButtonClick.bind(this));
            this.#updateFollowButtonPosition(); // Set initial position
            // --- End NEW ---
            this.#setupInteractions();
            this.#setupResizeHandling();
            this.redraw(); // Initial draw
        } else {
            // Headless mode: Initialize scales with default dimensions for calculations
            // These might not be accurate without a container, but provide a starting point.
            const { width, height } = calculateDimensions({ clientWidth: 600, clientHeight: 400 }, this.#margin); // Assume default size
            this.#width = width;
            this.#height = height;
            this.#scales = initializeScales(this.#d3, this.#width, this.#height);
            // No axes, line generator, or zoom needed without DOM
        }
    }

    // --- Private Initialization & Setup ---

    #assignInitialColors() {
        for (const seriesId in this.#seriesConfigs) {
            if (!this.#seriesConfigs[seriesId].color) {
                this.#seriesConfigs[seriesId].color = getColorForSeries(this.#colorScale, seriesId);
            }
        }
    }

    #initializeChartDOM() {
        if (!this.#targetElement) return;

        // Calculate initial dimensions
        const dims = calculateDimensions(this.#targetElement, this.#margin);
        this.#width = dims.width;
        this.#height = dims.height;

        // Create SVG structure
        const svgTotalWidth = this.#width + this.#margin.left + this.#margin.right;
        const svgTotalHeight = this.#height + this.#margin.top + this.#margin.bottom;
        this.#svgElements = createSVGStructure(this.#d3, this.#targetElement, svgTotalWidth, svgTotalHeight, this.#clipPathId, this.#margin);

        // Initialize D3 scales, axes, line generator
        this.#scales = initializeScales(this.#d3, this.#width, this.#height);
        this.#axesGenerators = initializeAxes(this.#d3, this.#scales);
        this.#lineGenerator = initializeLineGenerator(this.#d3, this.#scales);

        // Add axis labels
        addAxisLabels(this.#svgElements.mainGroup, this.#config, this.#width, this.#height, this.#margin);

        // Set initial clip path size
        this.#svgElements.svg.select(`#${this.#clipPathId} rect`)
            .attr("width", this.#width)
            .attr("height", this.#height);

        // Set initial zoom overlay size
        this.#svgElements.zoomOverlay
            .attr("width", this.#width)
            .attr("height", this.#height);
    }

    #setupInteractions() {
        if (!this.#targetElement || !this.#config.interactions.zoom) return; // Only setup if DOM exists and zoom enabled

        this.#zoomBehavior = initializeZoom(this.#d3, this.#width, this.#height, this.#onZoom.bind(this));
        applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, this.#isZoomEnabled());
    }

     #isZoomEnabled() {
        return this.#config.interactions.zoom || this.#config.interactions.pan;
    }

    #setupResizeHandling() {
        if (!this.#targetElement) return;
        this.#resizeObserver = setupResizeObserver(this.#targetElement, this.#onResize.bind(this));
    }

    // --- Event Handlers ---

    #onZoom(event) {
        if (this.#isDestroyed) return;

        // --- NEW: Disable follow mode on user zoom/pan ---
        if (this.#isFollowing) {
            this.#isFollowing = false;
            this.#frozenXDomain = null; // Don't freeze, the zoom defines the view
            this.#frozenYDomain = null;
            this.#updateFollowButtonAppearance();
            console.log("Follow mode turned OFF due to user interaction.");
        }
        // --- End NEW ---

        // Define redraw functions needed by handleZoom
        const redrawAxesAndGrid = () => {
            updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height);
            updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
        };
        const redrawLines = () => {
            updateLines(this.#svgElements.linesGroup, this.#dataStore, this.#seriesConfigs, this.#lineGenerator);
        };

        // Define domain getter functions
        const getFullX = () => getFullXDomain(this.#d3, this.#dataStore);
        const getFullY = () => getFullYDomain(this.#d3, this.#dataStore);

        this.#currentZoomTransform = handleZoom(
            event,
            this.#d3,
            this.#config,
            this.#scales,
            getFullX,
            getFullY,
            redrawAxesAndGrid,
            redrawLines
        );
        // Store the domains resulting from the zoom
        this.#frozenXDomain = this.#scales.xScale.domain();
        this.#frozenYDomain = this.#scales.yScale.domain();
    }

    #onResize() {
        if (this.#isDestroyed) return;

        const calculateAndUpdateDimensions = () => {
            const dims = calculateDimensions(this.#targetElement, this.#margin);
            this.#width = dims.width;
            this.#height = dims.height;
            return { newWidth: this.#width, newHeight: this.#height, newContainerWidth: dims.containerWidth, newContainerHeight: dims.containerHeight };
        };
        const updateScaleRanges = (newWidth, newHeight) => {
            this.#scales.xScale.range([0, newWidth]);
            this.#scales.yScale.range([newHeight, 0]);
        };
        const updateZoomExts = (newWidth, newHeight) => {
             updateZoomExtents(this.#zoomBehavior, newWidth, newHeight);
        };
        // Update both legend and follow button position
        const updateOverlayPositions = () => {
            if (this.#svgElements.legendGroup) {
                this.#svgElements.legendGroup.attr("transform", getLegendPosition(this.#svgElements.legendGroup.node(), this.#config, this.#margin, this.#width, this.#height));
            }
            this.#updateFollowButtonPosition(); // Call our new helper
        };
        const redraw = () => this.redraw();

        handleResize(
            this.#svgElements,
            this.#clipPathId,
            this.#margin,
            calculateAndUpdateDimensions,
            updateScaleRanges,
            updateZoomExts,
            updateOverlayPositions, // Pass the combined function
            redraw
        );
    }

    // --- Private Helper Methods ---

    #updateScalesAndAxes(animate = false, transition = null) {
        if (this.#isDestroyed || !this.#targetElement) return;

        const isZoomed = this.#currentZoomTransform && this.#currentZoomTransform !== this.#d3.zoomIdentity;

        if (!isZoomed) {
            // Not actively zoomed by user interaction
            if (this.#isFollowing) {
                // --- Follow Mode ON ---
                // Calculate domains based on data/config (original behavior)
                updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
                // Clear any frozen state (might be redundant, but safe)
                this.#frozenXDomain = null;
                this.#frozenYDomain = null;
            } else {
                // --- Follow Mode OFF (and not zoomed) ---
                // Use the frozen domains if they exist
                if (this.#frozenXDomain && this.#frozenYDomain) {
                    this.#scales.xScale.domain(this.#frozenXDomain);
                    this.#scales.yScale.domain(this.#frozenYDomain);
                } else {
                    // Fallback: If somehow frozen domains are null, calculate from data
                    // This might happen if follow was toggled before data arrived
                    updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
                }
            }
        }
        // ELSE: If user is zoomed (isZoomed is true), the zoom handler already set the scales.
        // We don't interfere, regardless of the #isFollowing state.
        // User interaction always takes precedence and implicitly turns Follow off (handled in #onZoom).

        // Always update visuals based on the *current* state of scales
        updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height, animate, transition);
        updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
    }

    #updateChartLines(animate = false, transition = null) {
        if (this.#isDestroyed || !this.#targetElement) return;
        updateLines(this.#svgElements.linesGroup, this.#dataStore, this.#seriesConfigs, this.#lineGenerator, animate, transition);
    }

    #updateChartLegend() {
        if (this.#isDestroyed || !this.#targetElement) return;
        updateLegend(this.#svgElements.legendGroup, this.#seriesConfigs, this.#config, this.#margin, this.#width, this.#height);
    }

    #onNewSeriesConfigCreated() {
        // Callback for ensureSeriesExists
        this.#updateChartLegend();
    }

    // --- Public API Methods ---

    addData(data) {
        if (this.#isDestroyed) return;
        let needsScaleUpdate = false;
        let latestX = -Infinity;
        let dataAdded = false;

        for (const seriesId in data) {
            if (!data[seriesId] || !Array.isArray(data[seriesId].x) || !Array.isArray(data[seriesId].y)) {
                console.warn(`Invalid data format for series ${seriesId}`);
                continue;
            }
            if (data[seriesId].x.length !== data[seriesId].y.length) {
                console.warn(`Mismatched x/y array lengths for series ${seriesId}`);
                continue;
            }

            ensureSeriesExists(seriesId, this.#dataStore, this.#seriesConfigs, this.#colorScale, this.#onNewSeriesConfigCreated.bind(this));

            const newPoints = data[seriesId].x.map((xVal, i) => ({ x: xVal, y: data[seriesId].y[i] }));

            if (newPoints.length > 0) {
                 this.#dataStore[seriesId].push(...newPoints);
                 pruneData(seriesId, this.#dataStore, this.#config);
                 needsScaleUpdate = true; // Assume new data might change scales
                 latestX = Math.max(latestX, newPoints[newPoints.length - 1].x);
                 dataAdded = true;
            }
        }

        if (!dataAdded) return; // No valid data points were added

        // Update view/scales only if DOM exists
        if (this.#targetElement && needsScaleUpdate) {
            // Always update scales/lines based on full data extent
            this.#updateScalesAndAxes(); // Recalculate domains based on new data
            this.#updateChartLines();
        }
    }

    setView(view, options = {}) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // --- NEW: Disable follow mode ---
        if (this.#isFollowing) {
            this.#isFollowing = false;
            this.#updateFollowButtonAppearance();
             console.log("Follow mode turned OFF due to setView call.");
        }
        this.#frozenXDomain = null; // View is being explicitly set
        this.#frozenYDomain = null;
        // --- End NEW ---

        const currentXDomain = this.#scales.xScale.domain();
        const currentYDomain = this.#scales.yScale.domain();

        // Determine target domains
        const targetXMin = typeof view.xMin === "number" ? view.xMin : currentXDomain[0];
        const targetXMax = typeof view.xMax === "number" ? view.xMax : currentXDomain[1];

        let finalYDomain;
        if (view.yMin === null || view.yMax === null) { // Auto-scale Y
            finalYDomain = calculateYDomain(this.#d3, this.#config, this.#dataStore, [targetXMin, targetXMax]);
        } else { // Manual Y
            const targetYMin = typeof view.yMin === "number" ? view.yMin : currentYDomain[0];
            const targetYMax = typeof view.yMax === "number" ? view.yMax : currentYDomain[1];
            finalYDomain = [targetYMin, targetYMax];
        }

        // --- Apply the change ---
        const transitionDuration = typeof options.transition === "number" ? options.transition : (options.transition ? 250 : 0);

        // Update the scales directly
        this.#scales.xScale.domain([targetXMin, targetXMax]);
        this.#scales.yScale.domain(finalYDomain);

        // Calculate the equivalent zoom transform to keep zoom state consistent
        // This allows subsequent user zooms to work correctly from the new view state.
        const fullX = getFullXDomain(this.#d3, this.#dataStore);
        const fullY = getFullYDomain(this.#d3, this.#dataStore);

        // Create temporary scales based on full domains to calculate transform
        const tempXScale = this.#d3.scaleLinear().domain(fullX).range(this.#scales.xScale.range());
        const tempYScale = this.#d3.scaleLinear().domain(fullY).range(this.#scales.yScale.range());

        // Calculate the transform needed to map the temp scales to the target domains
        this.#currentZoomTransform = this.#d3.zoomTransform(this.#svgElements.zoomOverlay.node()) // Get current base transform
                                        .rescaleX(tempXScale.domain(this.#scales.xScale.domain())) // Apply target X domain
                                        .rescaleY(tempYScale.domain(this.#scales.yScale.domain())); // Apply target Y domain


        // If using transition, animate the elements
        if (transitionDuration > 0 && this.#zoomBehavior) {
             const transition = this.#svgElements.svg.transition().duration(transitionDuration);
             // Animate zoom behavior state smoothly
             transition.call(this.#zoomBehavior.transform, this.#currentZoomTransform);
             // Need to also transition axes and lines manually using the same transition object
             this.#updateScalesAndAxes(true, transition); // Pass transition
             this.#updateChartLines(true, transition);   // Pass transition
        } else {
            // Apply immediately
            if (this.#zoomBehavior) {
                // Update internal zoom state without triggering the 'zoom' event
                 this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
            }
            this.redraw(); // Redraw everything based on new domains
        }
    }

    resetView(options = {}) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // --- NEW: Enable follow mode on reset ---
        if (!this.#isFollowing) {
             this.#isFollowing = true; // Reset usually implies going back to default (following)
             this.#updateFollowButtonAppearance();
             console.log("Follow mode turned ON due to resetView call.");
        }
        this.#frozenXDomain = null; // Reset clears any frozen state
        this.#frozenYDomain = null;
        // --- End NEW ---

        const targetXDomain = getFullXDomain(this.#d3, this.#dataStore);
        const targetYDomain = getFullYDomain(this.#d3, this.#dataStore); // Use full Y extent

        const transitionDuration = typeof options.transition === "number" ? options.transition : (options.transition ? 250 : 0);

        // Set scales directly
        this.#scales.xScale.domain(targetXDomain);
        this.#scales.yScale.domain(targetYDomain);

        // Reset the internal zoom transform state
        this.#currentZoomTransform = this.#d3.zoomIdentity;

        if (transitionDuration > 0 && this.#zoomBehavior) {
            const transition = this.#svgElements.svg.transition().duration(transitionDuration);
            // Animate zoom state reset
            transition.call(this.#zoomBehavior.transform, this.#d3.zoomIdentity);
            // Animate axes and lines
            this.#updateScalesAndAxes(true, transition);
            this.#updateChartLines(true, transition);
        } else {
            if (this.#zoomBehavior) {
                 // Reset zoom state immediately
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#d3.zoomIdentity);
            }
            this.redraw(); // Full redraw
        }
    }

    clearData() {
        if (this.#isDestroyed) return;
        this.#dataStore = {};
        // Keep seriesConfigs
        if (this.#targetElement) {
            this.redraw(); // Redraw empty chart if DOM exists
        }
    }

    updateSeriesConfig(seriesId, config) {
        if (this.#isDestroyed) return;

        // Ensure color is assigned if added via config update
        if (config.color === undefined && this.#seriesConfigs[seriesId]?.color === null) {
             config.color = getColorForSeries(this.#colorScale, seriesId);
        }

        const updated = updateSeriesConfigInternal(seriesId, config, this.#seriesConfigs);

        if (updated && this.#targetElement) {
            // Trigger updates visually if DOM exists
            this.#updateChartLines(); // Redraw lines with new styles
            this.#updateChartLegend(); // Update legend entry
        }
    }

    updateChartConfig(config) {
        if (this.#isDestroyed) return;

        const oldConfig = { ...this.#config }; // Shallow copy is enough for top-level checks
        const oldInteractions = { ...oldConfig.interactions };
        const oldLegend = { ...oldConfig.legend };
        const oldXAxis = { ...oldConfig.xAxis };
        const oldYAxis = { ...oldConfig.yAxis };


        // Deep merge, excluding 'series' property at the top level
        const { series, ...restConfig } = config; // Exclude series from the input
        this.#config = deepMerge(this.#config, restConfig);

        // Apply changes that require action (only if DOM exists)
        if (!this.#targetElement) return;

        let needsRedraw = false;
        let needsScaleUpdate = false;
        let needsLegendUpdate = false;
        let needsInteractionUpdate = false;

        // Check axis changes (range, label, grid visibility)
        if (JSON.stringify(oldXAxis) !== JSON.stringify(this.#config.xAxis) ||
            JSON.stringify(oldYAxis) !== JSON.stringify(this.#config.yAxis)) {
            needsScaleUpdate = true; // Range or grid visibility changes require scale/axis update
            updateAxisLabelsText(this.#svgElements.mainGroup, this.#config); // Update labels immediately
        }

        // Check legend changes
        if (JSON.stringify(oldLegend) !== JSON.stringify(this.#config.legend)) {
            needsLegendUpdate = true;
        }

        // Check interaction changes
        if (JSON.stringify(oldInteractions) !== JSON.stringify(this.#config.interactions)) {
            needsInteractionUpdate = true;
        }

        // Check max data points change
        if (oldConfig.maxDataPointsPerSeries !== this.#config.maxDataPointsPerSeries) {
            for (const seriesId in this.#dataStore) {
                pruneData(seriesId, this.#dataStore, this.#config);
            }
            needsRedraw = true; // Data might have changed
        }

        // Apply updates
        if (needsScaleUpdate) {
            this.#updateScalesAndAxes(); // Updates axes and grid lines implicitly
            needsRedraw = true; // Scales changed, redraw lines
        } else {
            // Check grid line visibility specifically if scales didn't change overall config
            if (oldXAxis.showGridLines !== this.#config.xAxis.showGridLines ||
                oldYAxis.showGridLines !== this.#config.yAxis.showGridLines) {
                 updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
            }
        }

        if (needsLegendUpdate) {
            this.#updateChartLegend();
        }

        if (needsInteractionUpdate && this.#zoomBehavior) {
            applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, this.#isZoomEnabled());
        }

        if (needsRedraw) {
            this.#updateChartLines(); // Ensure lines are redrawn if data/scales changed
        }
    }

    redraw() {
        if (this.#isDestroyed || !this.#targetElement) return;
        this.#updateScalesAndAxes();
        this.#updateChartLines();
        this.#updateChartLegend();
        // Grid lines are updated within #updateScalesAndAxes
    }

    destroy() {
        if (this.#isDestroyed) return;
        this.#isDestroyed = true;

        // --- NEW: Cleanup Follow Button ---
        if (this.#followButtonGroup) {
            this.#followButtonGroup.on("click", null); // Remove listener
            this.#followButtonGroup.remove();
            this.#followButtonGroup = null;
        }
        // --- End NEW ---

        // Cleanup DOM elements and observers if they exist
        if (this.#targetElement) {
            cleanupDOM(this.#svgElements.svg, this.#resizeObserver);
             // Remove D3 zoom listeners if zoom behavior exists

        this.#frozenXDomain = null; // Clear state
        this.#frozenYDomain = null;
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                this.#svgElements.zoomOverlay.on(".zoom", null);
            }
            this.#zoomBehavior?.on("zoom", null); // Clear listener on behavior itself
        }


        // Clear references
        this.#d3 = null;
        this.#targetElement = null;
        this.#config = null;
        this.#dataStore = {};
        this.#seriesConfigs = {};
        this.#svgElements = {}; // Clear all element references
        this.#scales = { xScale: null, yScale: null };
        this.#axesGenerators = { xAxis: null, yAxis: null };
        this.#lineGenerator = null;
        this.#zoomBehavior = null;
        this.#colorScale = null;
        this.#resizeObserver = null;
        this.#currentZoomTransform = null;

        console.log("StreamingChart destroyed.");
    }
}

module.exports = { StreamingChart }; // Export the class