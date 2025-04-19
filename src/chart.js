/**
 * Main StreamingChart class definition.
 * Orchestrates various modules for configuration, data, scales, rendering, DOM, and interactions.
 */

const { defaultConfig, deepMerge } = require('./config');
const { createColorScale, getColorForSeries } = require('./utils');
// Import assignInitialColors
const { initSeriesConfigs, getDefaultSeriesConfig, pruneData, ensureSeriesExists, updateSeriesConfig: updateSeriesConfigInternal, assignInitialColors } = require('./data');
const { initializeScales, initializeAxes, getFullXDomain, getFullYDomain, calculateXDomain, calculateYDomain, updateScaleDomains, updateAxes } = require('./scalesAxes');
const { initializeLineGenerator, updateGridLines, updateLines, updateLegend, getLegendPosition } = require('./rendering');
const { initializeZoom, applyZoomBehavior, updateZoomExtents, handleZoom } = require('./zoom');
const {
    calculateDimensions,
    createSVGStructure,
    addAxisLabels,
    updateAxisLabelsText,
    setupResizeObserver,
    handleResize,
    cleanupDOM,
    createFollowButton,
    // Import the moved functions
    updateFollowButtonAppearance,
    updateFollowButtonPosition
} = require('./dom');


class StreamingChart {
    // --- Private Instance Members ---

    // Configuration & State
    #d3; // Injected D3 library
    #config;
    #dataStore = {}; // { seriesId: [{x, y}, ...] }
    #seriesConfigs = {}; // Merged default/user configs per series
    #isDestroyed = false;
    #currentZoomTransform = null; // Stores the current d3.zoomTransform object
    #isZoomingOrPanning = false; // Flag to indicate an active zoom/pan gesture
    #initialScalesOnZoomStart = null; // Store scales at the start of a gesture

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

        // Use imported function
        assignInitialColors(this.#seriesConfigs, this.#colorScale);

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
            // Use imported function
            updateFollowButtonPosition(this.#followButtonGroup, this.#margin, this.#width, this.#height);
            // --- End NEW ---
            this.#setupInteractions(); // Setup unified zoom/pan
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
        if (!this.#targetElement || !this.#svgElements.zoomOverlay) return;

        const zoomEnabled = this.#config.interactions.zoom;
        const panEnabled = this.#config.interactions.pan;

        if (zoomEnabled || panEnabled) {
            if (!this.#zoomBehavior) {
                this.#zoomBehavior = initializeZoom(
                    this.#d3,
                    this.#width,
                    this.#height,
                    this.#onZoomStart.bind(this), // Pass start handler
                    this.#onZoom.bind(this),      // Pass zoom handler
                    this.#onZoomEnd.bind(this)    // Pass end handler
                );
            }
            // Apply the behavior (enables zoom/pan based on config)
            applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, zoomEnabled, panEnabled);

            // Apply the current transform state immediately in case it's not identity
            this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);

        } else {
            // Disable zoom/pan if both are false
            if (this.#zoomBehavior) {
                this.#svgElements.zoomOverlay.on(".zoom", null); // Remove listeners
                this.#svgElements.zoomOverlay.style("cursor", "default");
            }
        }
    }

    // --- REMOVED #setupDragBehavior ---

    #isInteractionEnabled() {
        // Helper to check if any interaction requires the zoom behavior
        return this.#config.interactions.zoom || this.#config.interactions.pan;
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
            this.#isZoomingOrPanning = false; // Ensure flag is reset

            // Reset D3 zoom state to identity *and* apply it
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                this.#currentZoomTransform = this.#d3.zoomIdentity;
                // Use transition for smoothness if desired, otherwise apply directly
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                console.log("Reset D3 zoom state as follow mode turned ON.");
            }

            // Recalculate domains based on data/config and redraw
            this.redraw(); // Redraw will use the new follow state

        }
        // Use imported function
        updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
        console.log(`Follow mode set to: ${this.#isFollowing}`);
    }

    // --- Event Handlers ---

    #onZoomStart(event) {
        if (this.#isDestroyed || !event.sourceEvent) return; // Ignore programmatic zoom starts

        // Store the state of the scales *before* the zoom/pan starts
        this.#initialScalesOnZoomStart = {
            xScale: this.#scales.xScale.copy(),
            yScale: this.#scales.yScale.copy()
        };
        this.#isZoomingOrPanning = true;

        // Disable follow mode immediately on user interaction
        if (this.#isFollowing) {
            this.#isFollowing = false;
            this.#frozenXDomain = null; // Will be set by the zoom/pan itself
            this.#frozenYDomain = null;
            updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
            console.log("Follow mode turned OFF due to user interaction.");
        }

        if (this.#config.interactions.pan) {
            this.#svgElements.zoomOverlay.style("cursor", "grabbing");
        }
    }


    #onZoom(event) {
        if (this.#isDestroyed || !this.#isZoomingOrPanning) return; // Only handle active gestures

        // Store the latest transform
        this.#currentZoomTransform = event.transform;

        // Check if zoom/pan is allowed by config before redrawing
        const zoomAllowed = this.#config.interactions.zoom && event.sourceEvent?.type === 'wheel';
        const panAllowed = this.#config.interactions.pan && event.sourceEvent?.type !== 'wheel'; // Crude check, D3 handles this better internally

        if (!zoomAllowed && !panAllowed) {
             // If neither is allowed, potentially revert? Or just do nothing.
             // For now, handleZoom will still update scales based on transform,
             // but maybe we should prevent the call if interaction is disabled.
             // Let's assume applyZoomBehavior handles disabling correctly for now.
        }

        // Prepare redraw functions
        const redrawAxesAndGrid = () => {
            updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height);
            updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
        };
        const redrawLines = () => {
            updateLines(this.#svgElements.linesGroup, this.#dataStore, this.#seriesConfigs, this.#lineGenerator);
        };

        // Call the zoom handler from zoom.js
        // It will modify this.#scales directly based on the transform and initial scales
        handleZoom(
            event,
            this.#scales, // Pass the live scales object
            this.#initialScalesOnZoomStart, // Pass the scales from the start of the gesture
            redrawAxesAndGrid,
            redrawLines
        );

        // Update frozen domains *during* the zoom/pan when follow is off
        if (!this.#isFollowing) {
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
        }
    }

     #onZoomEnd(event) {
        if (this.#isDestroyed) return;

        this.#isZoomingOrPanning = false;
        this.#initialScalesOnZoomStart = null; // Clear the initial state

        if (this.#config.interactions.pan) {
            this.#svgElements.zoomOverlay.style("cursor", "grab");
        }

        // Final update of frozen domains after the gesture ends
        if (!this.#isFollowing) {
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
            console.log("Finalized frozen domains after zoom/pan:", this.#frozenXDomain, this.#frozenYDomain);
        }
         // No need to synchronize transform here, #currentZoomTransform is updated in #onZoom
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
            // Re-apply the current transform to potentially adjust for new extent/center
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay && this.#isInteractionEnabled()) {
                 this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
            }
        };
        // Update both legend and follow button position
        const updateOverlayPositions = () => {
            if (this.#svgElements.legendGroup) {
                this.#svgElements.legendGroup.attr("transform", getLegendPosition(this.#svgElements.legendGroup.node(), this.#config, this.#margin, this.#width, this.#height));
            }
            // Use imported function
            updateFollowButtonPosition(this.#followButtonGroup, this.#margin, this.#width, this.#height);
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

        // If a zoom/pan gesture is active, the scales are already being handled by #onZoom
        if (this.#isZoomingOrPanning) {
             // We still need to update axes and grid based on the scales modified by handleZoom
             updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height, animate, transition);
             updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
             return; // Don't override scales set by zoom/pan
        }

        // --- Logic for when NOT actively zooming/panning ---
        if (this.#isFollowing) {
            // --- Follow Mode ON ---
            // Calculate domains based on data and config
            updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
            // Ensure zoom transform is identity when following
            if (this.#currentZoomTransform !== this.#d3.zoomIdentity) {
                 this.#currentZoomTransform = this.#d3.zoomIdentity;
                 if (this.#zoomBehavior && this.#svgElements.zoomOverlay && this.#isInteractionEnabled()) {
                     // Silently update D3's internal state if needed
                     this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                 }
            }
            this.#frozenXDomain = null;
            this.#frozenYDomain = null;
        } else {
            // --- Follow Mode OFF (and not zooming/panning) ---
            if (this.#frozenXDomain && this.#frozenYDomain) {
                // Apply the previously frozen domains
                this.#scales.xScale.domain(this.#frozenXDomain);
                this.#scales.yScale.domain(this.#frozenYDomain);
                // The #currentZoomTransform should already reflect this state
            } else {
                // No frozen state? This might happen if follow was just turned off
                // without interaction. Calculate based on data as a fallback.
                updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore);
                // Freeze this state now
                this.#frozenXDomain = this.#scales.xScale.domain();
                this.#frozenYDomain = this.#scales.yScale.domain();
                 // Also need to calculate the corresponding zoom transform here
                 this.#currentZoomTransform = this.#calculateTransformForDomains(this.#frozenXDomain, this.#frozenYDomain);
                 if (this.#zoomBehavior && this.#svgElements.zoomOverlay && this.#isInteractionEnabled()) {
                     this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                 }
            }
        }

        // Update axes and grid based on the determined scales
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

     // --- NEW Helper to calculate transform for given domains ---
     #calculateTransformForDomains(targetXDomain, targetYDomain) {
        if (!this.#targetElement || !targetXDomain || !targetYDomain) return this.#d3.zoomIdentity;

        // Get the full data extent to establish a base reference for the transform calculation
        // Although zoom/pan is relative to the view when follow=off,
        // we need a consistent base to calculate the transform *object* itself.
        const fullX = getFullXDomain(this.#d3, this.#dataStore, this.#config.xAxis.min, this.#config.xAxis.max);
        const fullY = getFullYDomain(this.#d3, this.#dataStore, this.#config.yAxis.min, this.#config.yAxis.max);

        // Create temporary scales representing the full data range mapped to the pixel range
        const tempFullXScale = this.#d3.scaleLinear().domain(fullX).range(this.#scales.xScale.range());
        const tempFullYScale = this.#d3.scaleLinear().domain(fullY).range(this.#scales.yScale.range());

        // Calculate the transform needed to make these temp scales show the target domains
        // k = base_range / target_range
        const kx = (tempFullXScale.range()[1] - tempFullXScale.range()[0]) / (tempFullXScale(targetXDomain[1]) - tempFullXScale(targetXDomain[0]));
        const ky = (tempFullYScale.range()[0] - tempFullYScale.range()[1]) / (tempFullYScale(targetYDomain[0]) - tempFullYScale(targetYDomain[1])); // Note range order for y

        // Use the geometric mean for uniform scaling (or choose one axis, e.g., kx)
        const k = Math.sqrt(kx * ky); // Or simply k = kx;

        // tx = -target_domain_start_in_pixels * k
        const tx = -tempFullXScale(targetXDomain[0]) * k;
        // ty = -target_domain_start_in_pixels * k
        const ty = -tempFullYScale(targetYDomain[1]) * k; // Use max domain value for y-pixel start

        // Clamp k within scaleExtent? D3 zoom usually handles this.
        const scaleExtent = this.#zoomBehavior?.scaleExtent() || [0.1, 100];
        const clampedK = Math.max(scaleExtent[0], Math.min(scaleExtent[1], k));

        // Adjust tx/ty if k was clamped? This gets complex. Let D3 handle clamping via .transform.
        // For simplicity, we calculate the ideal transform first.

        if (!isFinite(k) || !isFinite(tx) || !isFinite(ty)) {
             console.warn("Calculated invalid transform, returning identity.", { k, tx, ty, targetXDomain, targetYDomain, fullX, fullY });
             return this.#d3.zoomIdentity;
        }

        return this.#d3.zoomIdentity.translate(tx, ty).scale(clampedK); // Use clamped K
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
            // Only update scales/axes if following AND not currently zooming/panning
            if (this.#isFollowing && !this.#isZoomingOrPanning) {
                this.#updateScalesAndAxes(); // Updates scales and redraws axes/grid
                this.#updateChartLines();    // Redraws lines based on new scales
            } else {
                // Follow is OFF or user is interacting: only redraw lines on existing scales
                this.#updateChartLines();
            }
        }
    }


    setView(view, options = {}) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // --- Disable follow mode ---
        if (this.#isFollowing) {
            this.#isFollowing = false;
            updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
            console.log("Follow mode turned OFF due to setView call.");
        }
        this.#isZoomingOrPanning = false; // Ensure interaction flag is off

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

        // Set the target domains directly
        this.#scales.xScale.domain([targetXMin, targetXMax]);
        this.#scales.yScale.domain(finalYDomain);

        // Calculate the corresponding zoom transform for these domains
        this.#currentZoomTransform = this.#calculateTransformForDomains([targetXMin, targetXMax], finalYDomain);

        // Store the domains resulting from setView
        this.#frozenXDomain = this.#scales.xScale.domain();
        this.#frozenYDomain = this.#scales.yScale.domain();

        // Apply the transform using D3 zoom behavior
        if (this.#zoomBehavior && this.#isInteractionEnabled()) {
            if (transitionDuration > 0) {
                const transition = this.#svgElements.svg.transition().duration(transitionDuration);
                // Apply transform via transition
                transition.call(this.#zoomBehavior.transform, this.#currentZoomTransform)
                    .on("end", () => {
                        // Ensure scales match transform after transition
                        this.#scales.xScale = this.#currentZoomTransform.rescaleX(this.#calculateReferenceScale('x'));
                        this.#scales.yScale = this.#currentZoomTransform.rescaleY(this.#calculateReferenceScale('y'));
                        this.redraw(); // Full redraw after transition
                    });
                // Update axes/lines during transition
                this.#updateScalesAndAxes(true, transition); // Will use the target domains set above
                this.#updateChartLines(true, transition);
            } else {
                // Apply transform immediately
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                // Ensure scales match transform
                this.#scales.xScale = this.#currentZoomTransform.rescaleX(this.#calculateReferenceScale('x'));
                this.#scales.yScale = this.#currentZoomTransform.rescaleY(this.#calculateReferenceScale('y'));
                this.redraw(); // Redraw with final state
            }
        } else {
             // No zoom behavior, just redraw based on manually set scales
             this.redraw();
        }
    }

     // --- NEW Helper to get a base scale for transform calculations ---
     #calculateReferenceScale(axis = 'x') {
         // Use full data extent as the base reference for calculating transforms consistently
         const fullDomain = axis === 'x'
             ? getFullXDomain(this.#d3, this.#dataStore, this.#config.xAxis.min, this.#config.xAxis.max)
             : getFullYDomain(this.#d3, this.#dataStore, this.#config.yAxis.min, this.#config.yAxis.max);
         const range = axis === 'x' ? this.#scales.xScale.range() : this.#scales.yScale.range();
         return this.#d3.scaleLinear().domain(fullDomain).range(range);
     }


    resetView(options = {}) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // --- Enable follow mode on reset ---
        if (!this.#isFollowing) {
             this.#isFollowing = true;
             updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
             console.log("Follow mode turned ON due to resetView call.");
        }
        this.#frozenXDomain = null; // Reset clears any frozen state
        this.#frozenYDomain = null;
        this.#isZoomingOrPanning = false; // Ensure interaction flag is off

        // Target domains are calculated by #updateScalesAndAxes when isFollowing is true
        // Set the zoom transform to identity
        this.#currentZoomTransform = this.#d3.zoomIdentity;

        const transitionDuration = typeof options.transition === "number" ? options.transition : (options.transition ? 250 : 0);

        if (this.#zoomBehavior && this.#isInteractionEnabled()) {
            if (transitionDuration > 0) {
                const transition = this.#svgElements.svg.transition().duration(transitionDuration);
                // Transition to identity transform
                transition.call(this.#zoomBehavior.transform, this.#d3.zoomIdentity)
                    .on("end", () => {
                         this.#updateScalesAndAxes(); // Ensure scales match identity after transition
                         this.redraw();
                    });
                 // Update scales/axes/lines towards the target state during transition
                 this.#updateScalesAndAxes(true, transition); // Will calculate target domains based on follow=true
                 this.#updateChartLines(true, transition);
            } else {
                // Apply identity transform immediately
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#d3.zoomIdentity);
                this.redraw(); // Redraw will use follow=true state
            }
        } else {
             // No zoom behavior, just redraw based on follow=true state
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
            // Re-setup interactions based on new config
            this.#setupInteractions();
        }

        if (needsRedraw) {
            this.#updateChartLines();
        }
    }

    redraw() {
        if (this.#isDestroyed || !this.#targetElement) return;
        // #updateScalesAndAxes now correctly handles follow state and active zoom/pan
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
                    .style("cursor", "default");
            }
            this.#zoomBehavior?.on("zoom", null).on("start.zoom", null).on("end.zoom", null); // Clear internal listeners just in case
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