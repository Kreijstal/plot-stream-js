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
    handleResize, // Use the correct name
    cleanupDOM,
    // --- ADD THESE ---
    createFollowButton,
    updateFollowButtonAppearance,
    getFollowButtonPosition
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
            const { width, height } = calculateDimensions({ clientWidth: 600, clientHeight: 400 }, this.#margin); // Assume default size
            this.#width = width;
            this.#height = height;
            this.#scales = initializeScales(this.#d3, this.#width, this.#height);
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

        const dims = calculateDimensions(this.#targetElement, this.#margin);
        this.#width = dims.width;
        this.#height = dims.height;

        const svgTotalWidth = this.#width + this.#margin.left + this.#margin.right;
        const svgTotalHeight = this.#height + this.#margin.top + this.#margin.bottom;
        this.#svgElements = createSVGStructure(this.#d3, this.#targetElement, svgTotalWidth, svgTotalHeight, this.#clipPathId, this.#margin);

        this.#scales = initializeScales(this.#d3, this.#width, this.#height);
        this.#axesGenerators = initializeAxes(this.#d3, this.#scales);
        this.#lineGenerator = initializeLineGenerator(this.#d3, this.#scales);

        addAxisLabels(this.#svgElements.mainGroup, this.#config, this.#width, this.#height, this.#margin);

        this.#svgElements.svg.select(`#${this.#clipPathId} rect`)
            .attr("width", this.#width)
            .attr("height", this.#height);

        this.#svgElements.zoomOverlay
            .attr("width", this.#width)
            .attr("height", this.#height);
    }

    #setupInteractions() {
        if (!this.#targetElement) return;

        if (this.#config.interactions.zoom) {
            this.#zoomBehavior = initializeZoom(this.#d3, this.#width, this.#height, this.#onZoom.bind(this));
            applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, this.#isZoomEnabled());
        }

        // Set up drag behavior for panning
        if (this.#config.interactions.pan) {
            this.#setupDragBehavior();
        }
    }

    #setupDragBehavior() {
        // Store initial positions and domains for the drag operation
        let dragStart = null;
        let startXDomain = null;
        let startYDomain = null;

        const onDragStart = (event) => {
            if (this.#isDestroyed) return;
            event.preventDefault();
            
            dragStart = { x: event.x, y: event.y };
            startXDomain = [...this.#scales.xScale.domain()];
            startYDomain = [...this.#scales.yScale.domain()];

            // Disable follow mode on drag start
            if (this.#isFollowing) {
                this.#isFollowing = false;
                this.#updateFollowButtonAppearance();
                console.log("Follow mode turned OFF due to user pan.");
            }
        };

        const onDrag = (event) => {
            if (this.#isDestroyed || !dragStart) return;
            event.preventDefault();

            // Calculate pixel movement
            const dx = event.x - dragStart.x;
            const dy = event.y - dragStart.y;

            // Convert pixel movement to domain values
            const xRange = this.#scales.xScale.range();
            const yRange = this.#scales.yScale.range();
            const xDomainWidth = startXDomain[1] - startXDomain[0];
            const yDomainHeight = startYDomain[1] - startYDomain[0];

            // Calculate domain shift
            const xShift = (dx * xDomainWidth) / (xRange[1] - xRange[0]);
            const yShift = (dy * yDomainHeight) / (yRange[1] - yRange[0]); 
            this.#scales.xScale.domain([startXDomain[0] - xShift, startXDomain[1] - xShift]);
            this.#scales.yScale.domain([startYDomain[0] - yShift, startYDomain[1] - yShift]);

            // Store the current domains if follow mode is off
            if (!this.#isFollowing) {
                this.#frozenXDomain = this.#scales.xScale.domain();
                this.#frozenYDomain = this.#scales.yScale.domain();
            }

            // Redraw
            this.#updateScalesAndAxes();
            this.#updateChartLines();
        };

        const onDragEnd = (event) => {
            if (this.#isDestroyed) return;
            dragStart = null;
            startXDomain = null;
            startYDomain = null;

            // --- NEW: Synchronize D3 zoom state after drag ---
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                // Calculate the transform that corresponds to the current scale domains
                const fullX = getFullXDomain(this.#d3, this.#dataStore);
                const fullY = getFullYDomain(this.#d3, this.#dataStore);

                // Create temporary scales representing the full data range mapped to the pixel range
                const tempXScale = this.#d3.scaleLinear().domain(fullX).range(this.#scales.xScale.range());
                const tempYScale = this.#d3.scaleLinear().domain(fullY).range(this.#scales.yScale.range());

                // Calculate the transform needed to make the temp scales match the *current* domains
                // Use copies of the temp scales to avoid modifying them
                const newTransform = this.#d3.zoomIdentity
                    .rescaleX(tempXScale.copy().domain(this.#scales.xScale.domain()))
                    .rescaleY(tempYScale.copy().domain(this.#scales.yScale.domain()));

                // Store the new transform state
                this.#currentZoomTransform = newTransform;

                // Silently update the D3 zoom behavior's internal state
                // This prevents the zoom event handler from firing unnecessarily
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);

                console.log("Synchronized D3 zoom state after pan.");
            }
            // --- End NEW ---
        };

        // Add drag handlers to the zoom overlay
        this.#svgElements.zoomOverlay
            .style("cursor", "grab")
            .on("mousedown.drag", (event) => {
                this.#svgElements.zoomOverlay.style("cursor", "grabbing");
                onDragStart(event);
            })
            .on("mousemove.drag", onDrag)
            .on("mouseup.drag mouseleave.drag", (event) => {
                this.#svgElements.zoomOverlay.style("cursor", "grab");
                onDragEnd(event);
            })
            // Touch events
            .on("touchstart.drag", (event) => {
                event.preventDefault();
                const touch = event.touches[0];
                onDragStart({ x: touch.clientX, y: touch.clientY, preventDefault: () => {} });
            })
            .on("touchmove.drag", (event) => {
                event.preventDefault();
                const touch = event.touches[0];
                onDrag({ x: touch.clientX, y: touch.clientY, preventDefault: () => {} });
            })
            .on("touchend.drag", onDragEnd);
    }

    #isZoomEnabled() {
        return this.#config.interactions.zoom; // Only check zoom, as pan is handled separately
    }

    #setupResizeHandling() {
        if (!this.#targetElement) return;
        this.#resizeObserver = setupResizeObserver(this.#targetElement, this.#onResize.bind(this));
    }

    // --- NEW Method Definitions for Follow Button ---

    #onFollowButtonClick() {
        if (this.#isDestroyed) return;

        this.#isFollowing = !this.#isFollowing; // Toggle the state

        if (!this.#isFollowing) {
            // --- Turning Follow OFF ---
            // Store the current view domains
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
            // The currentZoomTransform should already reflect this state due to synchronization
        } else {
            // --- Turning Follow ON ---
            this.#frozenXDomain = null;
            this.#frozenYDomain = null;

            // Recalculate domains based on data/config
            this.#updateScalesAndAxes();

            // --- NEW: Reset D3 zoom state to identity ---
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                this.#currentZoomTransform = this.#d3.zoomIdentity;
                // Silently update the zoom behavior's internal state
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                console.log("Reset D3 zoom state as follow mode turned ON.");
            }
            // --- End NEW ---

            // Redraw lines with the new scales
            this.#updateChartLines();
        }
        this.#updateFollowButtonAppearance();
        console.log(`Follow mode set to: ${this.#isFollowing}`);
    }

    #updateFollowButtonAppearance() {
        if (this.#followButtonGroup) {
            updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
        }
    }

    #updateFollowButtonPosition() {
        if (this.#followButtonGroup) {
             this.#followButtonGroup.attr("transform", getFollowButtonPosition(
                 this.#followButtonGroup,
                 this.#margin,
                 this.#width,
                 this.#height
             ));
        }
    }

    // --- Event Handlers ---

    #onZoom(event) {
        if (this.#isDestroyed) return;

        // Only disable follow mode if the zoom event was triggered by a direct user interaction
        if (this.#isFollowing && event.sourceEvent) {
            this.#isFollowing = false;
            this.#frozenXDomain = null; // Don't freeze, the zoom defines the view
            this.#frozenYDomain = null;
            this.#updateFollowButtonAppearance();
            console.log("Follow mode turned OFF due to user interaction.");
        }

        // Calculate full extent scales for zooming
        const fullXDomain = getFullXDomain(this.#d3, this.#dataStore);
        const fullYDomain = getFullYDomain(this.#d3, this.#dataStore);
        const fullXScale = this.#d3.scaleLinear().domain(fullXDomain).range(this.#scales.xScale.range());
        const fullYScale = this.#d3.scaleLinear().domain(fullYDomain).range(this.#scales.yScale.range());

        const redrawAxesAndGrid = () => {
            updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height);
            updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
        };
        const redrawLines = () => {
            updateLines(this.#svgElements.linesGroup, this.#dataStore, this.#seriesConfigs, this.#lineGenerator);
        };

        this.#currentZoomTransform = handleZoom(
            event, this.#d3, this.#config, this.#scales,
            fullXScale, fullYScale, // Pass full extent scales
            redrawAxesAndGrid, redrawLines,
            this.#currentZoomTransform,
            this.#width, this.#height
        );
        // Store the domains resulting from the zoom/pan
        if (!this.#isFollowing) {
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
        }
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
                updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
                this.#frozenXDomain = null;
                this.#frozenYDomain = null;
            } else {
                // --- Follow Mode OFF (and not zoomed) ---
                if (this.#frozenXDomain && this.#frozenYDomain) {
                    this.#scales.xScale.domain(this.#frozenXDomain);
                    this.#scales.yScale.domain(this.#frozenYDomain);
                } else {
                    updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
                }
            }
        }
        // ELSE: If user is zoomed, the zoom handler already set the scales.

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
                 needsScaleUpdate = true; // Flag that scales *might* need update if following
                 latestX = Math.max(latestX, newPoints[newPoints.length - 1].x);
                 dataAdded = true;
            }
        }

        if (!dataAdded) return;

        if (this.#targetElement) {
            if (this.#isFollowing && needsScaleUpdate) {
                this.#updateScalesAndAxes(); // Updates scales and redraws axes/grid
                this.#updateChartLines();    // Redraws lines based on new scales
            } else {
                // Follow is OFF or no scale update needed (e.g., data added outside current view)
                this.#updateChartLines(); // Redraw lines based on existing (frozen) scales

                // --- NEW: Re-synchronize D3 zoom state if follow is OFF --- 
                // This ensures zoom behavior is aware of the current view relative to the 
                // potentially changed full data extent, even if the view itself didn't change.
                if (!this.#isFollowing && this.#zoomBehavior && dataAdded) { 
                    try {
                        const fullX = getFullXDomain(this.#d3, this.#dataStore); // Use updated dataStore
                        const fullY = getFullYDomain(this.#d3, this.#dataStore); // Use updated dataStore

                        // Ensure ranges are valid before creating temp scales
                        const xRange = this.#scales.xScale.range();
                        const yRange = this.#scales.yScale.range();
                        if (!xRange || !yRange || xRange.length < 2 || yRange.length < 2) {
                            console.warn("Cannot sync zoom: Invalid scale ranges.");
                            return;
                        }

                        const tempXScale = this.#d3.scaleLinear().domain(fullX).range(xRange);
                        const tempYScale = this.#d3.scaleLinear().domain(fullY).range(yRange);

                        // Use the frozen domains if available, otherwise current domains
                        const frozenX = this.#frozenXDomain || this.#scales.xScale.domain();
                        const frozenY = this.#frozenYDomain || this.#scales.yScale.domain();

                        // Ensure frozen domains are valid
                        if (!frozenX || !frozenY || frozenX.length < 2 || frozenY.length < 2) {
                             console.warn("Cannot sync zoom: Invalid frozen/current domains.");
                             return;
                        }

                        // Calculate the transform needed to map the temp scales to the frozen domains
                        const newTransform = this.#d3.zoomIdentity
                            .translate(xRange[0], yRange[0]) // Start with base translation
                            .scale(1) // Start with base scale
                            .rescaleX(tempXScale.copy().domain(frozenX))
                            .rescaleY(tempYScale.copy().domain(frozenY));

                        // Store the potentially updated transform state
                        this.#currentZoomTransform = newTransform;

                        // Silently update the D3 zoom behavior's internal state
                        this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                        // console.log("Re-synchronized D3 zoom state after addData (follow OFF).");
                    } catch (error) {
                        console.error("Error during zoom state synchronization in addData:", error);
                    }
                }
                // --- End NEW ---
            }
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

        const transitionDuration = typeof options.transition === "number" ? options.transition : (options.transition ? 250 : 0);

        this.#scales.xScale.domain([targetXMin, targetXMax]);
        this.#scales.yScale.domain(finalYDomain);

        const fullX = getFullXDomain(this.#d3, this.#dataStore);
        const fullY = getFullYDomain(this.#d3, this.#dataStore);
        const tempXScale = this.#d3.scaleLinear().domain(fullX).range(this.#scales.xScale.range());
        const tempYScale = this.#d3.scaleLinear().domain(fullY).range(this.#scales.yScale.range());

        this.#currentZoomTransform = this.#d3.zoomTransform(this.#svgElements.zoomOverlay.node())
                                        .rescaleX(tempXScale.domain(this.#scales.xScale.domain()))
                                        .rescaleY(tempYScale.domain(this.#scales.yScale.domain()));

        if (transitionDuration > 0 && this.#zoomBehavior) {
             const transition = this.#svgElements.svg.transition().duration(transitionDuration);
             transition.call(this.#zoomBehavior.transform, this.#currentZoomTransform);
             this.#updateScalesAndAxes(true, transition);
             this.#updateChartLines(true, transition);
        } else {
            if (this.#zoomBehavior) {
                 this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
            }
            this.redraw();
        }
         // After scales are updated by setView logic:
         // Store the domains resulting from setView
         this.#frozenXDomain = this.#scales.xScale.domain();
         this.#frozenYDomain = this.#scales.yScale.domain();
    }

    resetView(options = {}) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // --- NEW: Enable follow mode on reset ---
        if (!this.#isFollowing) {
             this.#isFollowing = true;
             this.#updateFollowButtonAppearance();
             console.log("Follow mode turned ON due to resetView call.");
        }
        this.#frozenXDomain = null; // Reset clears any frozen state
        this.#frozenYDomain = null;
        // --- End NEW ---

        const targetXDomain = getFullXDomain(this.#d3, this.#dataStore);
        const targetYDomain = getFullYDomain(this.#d3, this.#dataStore);

        const transitionDuration = typeof options.transition === "number" ? options.transition : (options.transition ? 250 : 0);

        this.#scales.xScale.domain(targetXDomain);
        this.#scales.yScale.domain(targetYDomain);

        this.#currentZoomTransform = this.#d3.zoomIdentity;

        if (transitionDuration > 0 && this.#zoomBehavior) {
            const transition = this.#svgElements.svg.transition().duration(transitionDuration);
            transition.call(this.#zoomBehavior.transform, this.#d3.zoomIdentity);
            this.#updateScalesAndAxes(true, transition);
            this.#updateChartLines(true, transition);
        } else {
            if (this.#zoomBehavior) {
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#d3.zoomIdentity);
            }
            this.redraw();
        }
    }

    clearData() {
        if (this.#isDestroyed) return;
        this.#dataStore = {};
        if (this.#targetElement) {
            this.redraw();
        }
    }

    updateSeriesConfig(seriesId, config) {
        if (this.#isDestroyed) return;

        if (config.color === undefined && this.#seriesConfigs[seriesId]?.color === null) {
             config.color = getColorForSeries(this.#colorScale, seriesId);
        }

        const updated = updateSeriesConfigInternal(seriesId, config, this.#seriesConfigs);

        if (updated && this.#targetElement) {
            this.#updateChartLines();
            this.#updateChartLegend();
        }
    }

    updateChartConfig(config) {
        if (this.#isDestroyed) return;

        const oldConfig = { ...this.#config };
        const oldInteractions = { ...oldConfig.interactions };
        const oldLegend = { ...oldConfig.legend };
        const oldXAxis = { ...oldConfig.xAxis };
        const oldYAxis = { ...oldConfig.yAxis };

        const { series, ...restConfig } = config;
        this.#config = deepMerge(this.#config, restConfig);

        if (!this.#targetElement) return;

        let needsRedraw = false;
        let needsScaleUpdate = false;
        let needsLegendUpdate = false;
        let needsInteractionUpdate = false;

        if (JSON.stringify(oldXAxis) !== JSON.stringify(this.#config.xAxis) ||
            JSON.stringify(oldYAxis) !== JSON.stringify(this.#config.yAxis)) {
            needsScaleUpdate = true;
            updateAxisLabelsText(this.#svgElements.mainGroup, this.#config);
        }

        if (JSON.stringify(oldLegend) !== JSON.stringify(this.#config.legend)) {
            needsLegendUpdate = true;
        }

        if (JSON.stringify(oldInteractions) !== JSON.stringify(this.#config.interactions)) {
            needsInteractionUpdate = true;
        }

        if (oldConfig.maxDataPointsPerSeries !== this.#config.maxDataPointsPerSeries) {
            for (const seriesId in this.#dataStore) {
                pruneData(seriesId, this.#dataStore, this.#config);
            }
            needsRedraw = true;
        }

        if (needsScaleUpdate) {
            this.#updateScalesAndAxes();
            needsRedraw = true;
        } else {
            if (oldXAxis.showGridLines !== this.#config.xAxis.showGridLines ||
                oldYAxis.showGridLines !== this.#config.yAxis.showGridLines) {
                 updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
            }
        }

        if (needsLegendUpdate) {
            this.#updateChartLegend();
        }

        if (needsInteractionUpdate && this.#targetElement) {
            if (this.#zoomBehavior) {
                applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, this.#isZoomEnabled());
            }
            
            // Handle pan behavior changes
            if (this.#config.interactions.pan) {
                this.#setupDragBehavior(); // Set up drag if pan is enabled
            } else {
                // Remove drag behavior if pan is disabled
                this.#svgElements.zoomOverlay
                    .on(".drag", null)
                    .style("cursor", null);
            }
        }

        if (needsRedraw) {
            this.#updateChartLines();
        }
    }

    redraw() {
        if (this.#isDestroyed || !this.#targetElement) return;
        this.#updateScalesAndAxes();
        this.#updateChartLines();
        this.#updateChartLegend();
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

        if (this.#targetElement) {
            cleanupDOM(this.#svgElements.svg, this.#resizeObserver);
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                this.#svgElements.zoomOverlay
                    .on(".zoom", null)
                    .on(".drag", null) // Remove all drag event handlers
                    .style("cursor", null); // Reset cursor style
            }
            this.#zoomBehavior?.on("zoom", null);
        }

        this.#frozenXDomain = null;
        this.#frozenYDomain = null;

        // Clear references
        this.#d3 = null;
        this.#targetElement = null;
        this.#config = null;
        this.#dataStore = {};
        this.#seriesConfigs = {};
        this.#svgElements = {};
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