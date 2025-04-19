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
const { initializeZoom, applyZoomBehavior, updateZoomExtents } = require('./zoom'); // Remove handleZoom import
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
    // REMOVE: #initialScalesOnZoomStart = null;

    // --- NEW State for lib2.js style zoom ---
    #initialXScale = null; // Base scale for D3 zoom calculations
    #initialYScale = null; // Base scale for D3 zoom calculations
    #referenceXScale = null; // Reference for independent X zoom
    #referenceYScale = null; // Reference for independent Y zoom
    #isProgrammaticZoom = false; // Flag to prevent zoom event feedback loops
    #lastZoomLevel = 1; // Store last zoom level for standard zoom

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
        this.#lastZoomLevel = 1; // Initialize zoom level

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
            this.#initializeChartDOM(); // Initializes scales, including initial/reference
            // --- NEW: Create the follow button ---
            this.#followButtonGroup = createFollowButton(this.#svgElements.svg, this.#onFollowButtonClick.bind(this));
            // Use imported function
            updateFollowButtonPosition(this.#followButtonGroup, this.#margin, this.#width, this.#height);
            // --- End NEW ---
            this.#setupInteractions(); // Setup unified zoom/pan using the new handler
            this.#setupResizeHandling();
            this.redraw(); // Initial draw
        } else {
            // Headless mode: Initialize scales with default dimensions for calculations
            const { width, height } = calculateDimensions({ clientWidth: 600, clientHeight: 400 }, this.#margin); // Assume default size
            this.#width = width;
            this.#height = height;
            this.#scales = initializeScales(this.#d3, this.#width, this.#height);
            // --- NEW: Initialize initial/reference scales even in headless mode ---
            this.#initialXScale = this.#scales.xScale.copy();
            this.#initialYScale = this.#scales.yScale.copy();
            this.#referenceXScale = this.#scales.xScale.copy();
            this.#referenceYScale = this.#scales.yScale.copy();
            // --- End NEW ---
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
        // --- NEW: Initialize initial/reference scales ---
        this.#initialXScale = this.#scales.xScale.copy();
        this.#initialYScale = this.#scales.yScale.copy();
        this.#referenceXScale = this.#scales.xScale.copy();
        this.#referenceYScale = this.#scales.yScale.copy();
        // --- End NEW ---
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
                // --- UPDATED: Use the new combined handler ---
                this.#zoomBehavior = this.#d3.zoom()
                    .scaleExtent([0.1, 100]) // Example extent, make configurable?
                    .extent([[0, 0], [this.#width, this.#height]])
                    .on("zoom", this.#handleZoomEvent.bind(this)); // Use the new handler
                // --- End UPDATED ---
            }
            // Apply the behavior (enables zoom/pan based on config)
            applyZoomBehavior(this.#svgElements.zoomOverlay, this.#zoomBehavior, zoomEnabled, panEnabled);

            // Apply the current transform state immediately
            // Use isProgrammaticZoom flag to prevent the event handler from reacting to this call
            this.#isProgrammaticZoom = true;
            this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
            this.#isProgrammaticZoom = false;

        } else {
            // Disable zoom/pan if both are false
            if (this.#zoomBehavior) {
                this.#svgElements.zoomOverlay.on(".zoom", null); // Remove listeners
                this.#svgElements.zoomOverlay.style("cursor", "default");
            }
        }
    }

    // --- REMOVED #setupDragBehavior ---
    // --- REMOVED #isInteractionEnabled (can check config directly) ---

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
            // Store the current view domains from the drawing scales
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
            // Sync initial/reference scales and D3 state to match this frozen view
            this.#syncScalesAndZoomState(this.#frozenXDomain, this.#frozenYDomain);

        } else {
            // --- Turning Follow ON ---
            this.#frozenXDomain = null;
            this.#frozenYDomain = null;
            this.#isZoomingOrPanning = false; // Ensure flag is reset

            // Reset D3 zoom state to identity *and* apply it
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                this.#currentZoomTransform = this.#d3.zoomIdentity;
                this.#lastZoomLevel = 1;
                this.#isProgrammaticZoom = true;
                // Use transition for smoothness if desired, otherwise apply directly
                this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                this.#isProgrammaticZoom = false;
                console.log("Reset D3 zoom state as follow mode turned ON.");
            }

            // Recalculate domains based on data/config and redraw
            // Redraw will use the new follow state and identity transform
            this.redraw();

        }
        // Use imported function
        updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
        console.log(`Follow mode set to: ${this.#isFollowing}`);
    }

    // --- Event Handlers ---

    // --- REMOVED #onZoomStart ---
    // --- REMOVED #onZoom ---
    // --- REMOVED #onZoomEnd ---

    // --- NEW Combined Zoom Handler (based on lib2.js) ---
    #handleZoomEvent(event) {
        const sourceEvent = event.sourceEvent;
        const transform = event.transform; // The transform calculated by D3 relative to its *internal* state

        // ** Guard against events triggered by our own zoom.transform calls **
        if (this.#isProgrammaticZoom) {
            // console.log("Ignoring programmatic zoom event");
            return;
        }

        // Disable follow mode immediately on user interaction
        if (this.#isFollowing && sourceEvent) {
            this.#isFollowing = false;
            // Store current domains before they change
            this.#frozenXDomain = this.#scales.xScale.domain();
            this.#frozenYDomain = this.#scales.yScale.domain();
            // Sync initial/reference scales to this state *before* applying the new zoom
            this.#syncScalesAndZoomState(this.#frozenXDomain, this.#frozenYDomain);
            updateFollowButtonAppearance(this.#followButtonGroup, this.#isFollowing);
            console.log("Follow mode turned OFF due to user interaction.");
        }

        // Set zooming flag (useful for addData logic)
        this.#isZoomingOrPanning = true; // Set flag when interaction starts
        // We need a way to reset this flag. D3 zoom doesn't have a distinct 'end' event
        // when using only the 'zoom' listener. We might need a debounce/timer or
        // rely on the fact that redraws outside of this handler will see the flag.
        // For now, let's assume redraw() or other actions will reset it if needed,
        // or maybe reset it after a short delay if no further zoom events occur.
        // Let's add a simple debounce for resetting the flag.
        clearTimeout(this._zoomEndTimer);
        this._zoomEndTimer = setTimeout(() => { this.#isZoomingOrPanning = false; }, 150);


        // console.log(
        //     `Zoom event: type=${event.type}, source=${sourceEvent?.type}, alt=${
        //     sourceEvent?.altKey
        //     }, shift=${sourceEvent?.shiftKey}, k=${transform.k.toFixed(3)}`
        // );

        let newXDomain = this.#scales.xScale.domain(); // Start with current drawing domains
        let newYDomain = this.#scales.yScale.domain();
        let domainChanged = false;
        let isAltZoom = false; // Reset flag for this event
        let isShiftZoom = false; // Flag for horizontal/X-axis zoom

        const independentZoomFactor = 1.5; // Make configurable?

        // --- Alt+Scroll Logic (Y-axis zoom) ---
        if (sourceEvent && sourceEvent.type === "wheel" && sourceEvent.altKey) {
            isAltZoom = true;
            sourceEvent.preventDefault();
            const wheelDeltaY = sourceEvent.deltaY || 0;
            const pointerY_svg = sourceEvent.offsetY;
            const pointerY_plot = pointerY_svg - this.#margin.top;

            // Zoom direction based on vertical scroll
            const zoomDirection = wheelDeltaY < 0 ? independentZoomFactor : 1 / independentZoomFactor;
            const yValue_plot = this.#referenceYScale.invert(pointerY_plot);
            const [y0, y1] = this.#referenceYScale.domain(); // Use reference scale!

            newYDomain = [
                yValue_plot + (y0 - yValue_plot) / zoomDirection,
                yValue_plot + (y1 - yValue_plot) / zoomDirection
            ];
            domainChanged = true;
            // console.log("Alt+Zoom (Y)");
        }
        // --- Shift+Scroll Logic (X-axis zoom) ---
        // Trigger on shift key OR if horizontal delta is clearly dominant
        else if (
            sourceEvent &&
            sourceEvent.type === "wheel" &&
            (sourceEvent.shiftKey ||
            Math.abs(sourceEvent.deltaX) > Math.abs(sourceEvent.deltaY * 2))
        ) {
            isShiftZoom = true;
            sourceEvent.preventDefault();
            const wheelDeltaX = sourceEvent.deltaX || 0;
            const pointerX_svg = sourceEvent.offsetX;
            const pointerX_plot = pointerX_svg - this.#margin.left;

            // Zoom direction based on horizontal scroll
            const zoomDirection = wheelDeltaX < 0 ? independentZoomFactor : 1 / independentZoomFactor;
            const xValue_plot = this.#referenceXScale.invert(pointerX_plot);
            const [x0, x1] = this.#referenceXScale.domain(); // Use reference scale!
            newXDomain = [
                xValue_plot + (x0 - xValue_plot) / zoomDirection,
                xValue_plot + (x1 - xValue_plot) / zoomDirection
            ];
            domainChanged = true;
            // console.log("Shift+Zoom (X)");
        }
        // --- Standard Zoom/Pan Logic ---
        else if (sourceEvent) { // Only apply standard zoom if triggered by user event
            // Apply the event's transform relative to our *initial* scales
            newXDomain = transform.rescaleX(this.#initialXScale).domain();
            newYDomain = transform.rescaleY(this.#initialYScale).domain();
            domainChanged = true;

            // Update internal state tracking based on the *event's* transform
            this.#currentZoomTransform = transform;
            this.#lastZoomLevel = transform.k;
            // console.log("Standard Zoom/Pan");
        } else {
             // This case might happen on programmatic transform calls if the guard fails
             // Or potentially other D3 internal events. Let's ignore them for domain changes.
             console.log("Zoom event with no sourceEvent, ignoring for domain change.");
        }


        // --- Apply Changes and Update References/Initial/ZoomState ---
        if (domainChanged) {
            // Apply to drawing scales
            this.#scales.xScale.domain(newXDomain);
            this.#scales.yScale.domain(newYDomain);

            // *** ALWAYS update reference scales to match the new drawing state ***
            this.#referenceXScale.domain(newXDomain);
            this.#referenceYScale.domain(newYDomain);
            // console.log("  Updated reference scales to match new drawing state.");

            if (isAltZoom || isShiftZoom) {
                // Handle Alt/Shift+Zoom specific state updates AFTER applying domain changes
                console.log("  Alt/Shift+Zoom event: Updating initial scales, internal state, and resetting D3 transform.");

                // Update the initial scales to reflect this new base state
                this.#initialXScale.domain(newXDomain);
                this.#initialYScale.domain(newYDomain);

                // Update our internal tracking to reflect the new base state immediately
                this.#currentZoomTransform = this.#d3.zoomIdentity;
                this.#lastZoomLevel = 1;

                // ** Reset D3's internal transform state *immediately* **
                if (this.#zoomBehavior && this.#svgElements.zoomOverlay) {
                    this.#isProgrammaticZoom = true;
                    this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#d3.zoomIdentity);
                    this.#isProgrammaticZoom = false;
                }
            }
            // (If Standard Zoom, currentZoomTransform and lastZoomLevel were already updated above)

            // Update frozen domains if follow is off
            if (!this.#isFollowing) {
                this.#frozenXDomain = newXDomain;
                this.#frozenYDomain = newYDomain;
            }

            // Log final state
            // if (this.#config.debug) { // Add debug config later if needed
            //     const format = (d) => d.toFixed(3);
            //     console.log(
            //         `  Applied Viewport: X=[${format(this.#scales.xScale.domain()[0])}, ${format(
            //         this.#scales.xScale.domain()[1]
            //         )}], Y=[${format(this.#scales.yScale.domain()[0])}, ${format(this.#scales.yScale.domain()[1])}]`
            //     );
            //     // Log initial scales ONLY if alt/shift zoom happened, as they should match Applied Viewport then
            //     if (isAltZoom || isShiftZoom)
            //         console.log(
            //         `  Initial Scales now: X=[${format(
            //             this.#initialXScale.domain()[0]
            //         )}, ${format(this.#initialXScale.domain()[1])}], Y=[${format(
            //             this.#initialYScale.domain()[0]
            //         )}, ${format(this.#initialYScale.domain()[1])}]`
            //         );
            //     console.log(` Current transform k: ${this.#currentZoomTransform.k.toFixed(3)}`)
            // }

            // Request redraw using the updated scales
            this.#redrawOnZoom();

            // Dispatch a custom event if needed (optional)
            // this.#svgElements.svg.dispatch("plotzoom", { detail: { ... } });

        } else {
            // console.log("  No domain change detected in zoom event.");
            // Still update the flag if needed
            clearTimeout(this._zoomEndTimer);
            this._zoomEndTimer = setTimeout(() => { this.#isZoomingOrPanning = false; }, 150);
        }
    }
    // --- End NEW Zoom Handler ---


    #onResize() {
        if (this.#isDestroyed) return;

        const calculateAndUpdateDimensions = () => {
           const dims = calculateDimensions(this.#targetElement, this.#margin);
           this.#width = dims.width;
           this.#height = dims.height;
           return { newWidth: this.#width, newHeight: this.#height, newContainerWidth: dims.containerWidth, newContainerHeight: dims.containerHeight };
        };
        const updateScaleRanges = (newWidth, newHeight) => {
           // Update ranges for ALL scales
           this.#scales.xScale.range([0, newWidth]);
           this.#scales.yScale.range([newHeight, 0]);
           this.#initialXScale.range([0, newWidth]);
           this.#initialYScale.range([newHeight, 0]);
           this.#referenceXScale.range([0, newWidth]);
           this.#referenceYScale.range([newHeight, 0]);
        };
        const updateZoomExts = (newWidth, newHeight) => {
            updateZoomExtents(this.#zoomBehavior, newWidth, newHeight);
            // Re-apply the current transform to adjust for new extent/center
            // This might implicitly trigger a zoom event, handled by #handleZoomEvent
            if (this.#zoomBehavior && this.#svgElements.zoomOverlay && (this.#config.interactions.zoom || this.#config.interactions.pan)) {
                 this.#isProgrammaticZoom = true;
                 this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, this.#currentZoomTransform);
                 this.#isProgrammaticZoom = false;
                 // After transform, ensure scales are consistent. The zoom event handler
                 // might not run if the transform didn't actually change D3's internal state enough,
                 // or if it was guarded. Let's manually sync scales based on the current transform.
                 this.#syncScalesToCurrentTransform();
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
        const redraw = () => this.redraw(); // Full redraw needed after resize

        handleResize(
            this.#svgElements,
            this.#clipPathId,
            this.#margin,
            calculateAndUpdateDimensions,
            updateScaleRanges,
            updateZoomExts,
            updateOverlayPositions,
            redraw // Use full redraw
        );
    }

    // --- Private Helper Methods ---

    // --- NEW: Helper to redraw parts affected by zoom ---
    #redrawOnZoom() {
        // Only redraw axes, grid, and lines, which depend directly on scale domains/ranges
        updateAxes(this.#svgElements, this.#axesGenerators, this.#scales, this.#height);
        updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
        updateLines(this.#svgElements.linesGroup, this.#dataStore, this.#seriesConfigs, this.#lineGenerator);
        // Legend doesn't usually need updating on zoom
    }

    // --- UPDATED: Simplified scale/axis update logic ---
    #updateScalesAndAxes(animate = false, transition = null) {
        if (this.#isDestroyed || !this.#targetElement) return;

        // If a zoom/pan gesture is active, scales are handled by #handleZoomEvent
        // and #redrawOnZoom handles the visual updates. So, do nothing here during interaction.
        if (this.#isZoomingOrPanning) {
            return;
        }

        // --- Logic for when NOT actively zooming/panning ---
        if (this.#isFollowing) {
            // --- Follow Mode ON ---
            // Calculate domains based on data, config, and *follow state*
            updateScaleDomains(this.#d3, this.#config, this.#scales, this.#dataStore, this.#isFollowing); // Pass isFollowing
            // Ensure zoom transform is identity and initial/reference scales match
            if (this.#currentZoomTransform !== this.#d3.zoomIdentity) {
                 this.#syncScalesAndZoomState(this.#scales.xScale.domain(), this.#scales.yScale.domain(), this.#d3.zoomIdentity);
            } else {
                 // If transform is already identity, still ensure initial/ref scales match drawing scales
                 this.#initialXScale.domain(this.#scales.xScale.domain());
                 this.#initialYScale.domain(this.#scales.yScale.domain());
                 this.#referenceXScale.domain(this.#scales.xScale.domain());
                 this.#referenceYScale.domain(this.#scales.yScale.domain());
            }
            this.#frozenXDomain = null;
            this.#frozenYDomain = null;
        } else {
            // --- Follow Mode OFF (and not zooming/panning) ---
            // Scales should already be correctly set by the last zoom event or setView call.
            // We just need to ensure the visual elements (axes/grid) match the current #scales.
            // No need to recalculate domains or transforms here.
            // If #frozenXDomain exists, #scales should already match it.
            if (this.#frozenXDomain) {
                this.#scales.xScale.domain(this.#frozenXDomain);
                this.#scales.yScale.domain(this.#frozenYDomain);
            } else {
                // This case shouldn't ideally happen if state management is correct,
                // but as a fallback, sync to the current transform.
                this.#syncScalesToCurrentTransform();
                this.#frozenXDomain = this.#scales.xScale.domain();
                this.#frozenYDomain = this.#scales.yScale.domain();
            }
        }

        // Update axes and grid based on the determined/existing #scales
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

     // --- REMOVED #calculateTransformForDomains ---

     // --- NEW Helper to sync initial/reference scales and optionally D3 state ---
     #syncScalesAndZoomState(targetXDomain, targetYDomain, targetTransform = null) {
         if (!targetXDomain || !targetYDomain) return;

         // Update drawing scales
         this.#scales.xScale.domain(targetXDomain);
         this.#scales.yScale.domain(targetYDomain);

         // Update initial and reference scales
         this.#initialXScale.domain(targetXDomain);
         this.#initialYScale.domain(targetYDomain);
         this.#referenceXScale.domain(targetXDomain);
         this.#referenceYScale.domain(targetYDomain);

         // Update D3 zoom state if a target transform is provided
         if (targetTransform && this.#zoomBehavior && this.#svgElements.zoomOverlay) {
             this.#currentZoomTransform = targetTransform;
             this.#lastZoomLevel = targetTransform.k;
             this.#isProgrammaticZoom = true;
             this.#zoomBehavior.transform(this.#svgElements.zoomOverlay, targetTransform);
             this.#isProgrammaticZoom = false;
         }
         // If no targetTransform provided, the caller is responsible for ensuring
         // this.#currentZoomTransform is correct (e.g., could be identity after alt/shift zoom).
     }

     // --- NEW Helper to sync scales based *only* on the current transform ---
     // Useful after resize or programmatic transform updates.
     #syncScalesToCurrentTransform() {
         if (!this.#currentZoomTransform) return;
         // Assume initial scales are the correct base for the current transform
         this.#scales.xScale = this.#currentZoomTransform.rescaleX(this.#initialXScale);
         this.#scales.yScale = this.#currentZoomTransform.rescaleY(this.#initialYScale);
         // Reference scales should match drawing scales
         this.#referenceXScale.domain(this.#scales.xScale.domain());
         this.#referenceYScale.domain(this.#scales.yScale.domain());
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
                // This will recalculate domains based on new data and apply to #scales
                // It also ensures initial/reference scales and zoom state are synced (to identity)
                this.#updateScalesAndAxes();
                this.#updateChartLines();    // Redraws lines based on new scales
            } else {
                // Follow is OFF or user is interacting: only redraw lines on existing scales
                // Data is added, but the view remains frozen or controlled by user interaction.
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
        const targetXDomain = [targetXMin, targetXMax];

        let targetYDomain;
        if (view.yMin === null || view.yMax === null) {
            // Auto-calculate Y based on the *target* X domain
            targetYDomain = calculateYDomain(this.#d3, this.#config, this.#dataStore, targetXDomain);
        } else {
            const targetYMin = typeof view.yMin === "number" ? view.yMin : currentYDomain[0];
            const targetYMax = typeof view.yMax === "number" ? view.yMax : currentYDomain[1];
            targetYDomain = [targetYMin, targetYMax];
        }

        // Store as the new frozen state
        this.#frozenXDomain = targetXDomain;
        this.#frozenYDomain = targetYDomain;

        // Sync all scales and reset D3 zoom state to identity, reflecting the new base view
        this.#syncScalesAndZoomState(targetXDomain, targetYDomain, this.#d3.zoomIdentity);

        // Redraw everything based on the new scale domains
        // TODO: Add transition support if needed, similar to lib2.js reset/setDomain
        this.redraw();
    }

     // --- REMOVED #calculateReferenceScale ---


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

        // Calculate the 'natural' domains based on current data/config, considering follow state
        const tempScales = { xScale: this.#scales.xScale.copy(), yScale: this.#scales.yScale.copy() };
        updateScaleDomains(this.#d3, this.#config, tempScales, this.#dataStore, this.#isFollowing); // Pass isFollowing
        const targetXDomain = tempScales.xScale.domain();
        const targetYDomain = tempScales.yScale.domain();

        // Sync all scales to these domains and reset D3 zoom state to identity
        this.#syncScalesAndZoomState(targetXDomain, targetYDomain, this.#d3.zoomIdentity);

        // Redraw everything
        // TODO: Add transition support if needed
        this.redraw();
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

        const { series, ...restConfig } = config; // Separate series config
        this.#config = deepMerge(this.#config, restConfig);

        // Apply series-specific updates if provided
        if (series && typeof series === 'object') {
            for (const seriesId in series) {
                this.updateSeriesConfig(seriesId, series[seriesId]); // Use existing method
            }
        }


        if (!this.#targetElement) return; // Nothing more to do in headless mode

        let needsFullRedraw = false;
        let needsScaleUpdate = false; // Specifically for domain calculation changes
        let needsInteractionUpdate = false;
        let needsZoomReset = false; // If axis range config changes

        // Check if axis range config changed (min/max values)
        if (JSON.stringify(oldXAxis.range) !== JSON.stringify(this.#config.xAxis.range) ||
            JSON.stringify(oldYAxis.range) !== JSON.stringify(this.#config.yAxis.range)) {
            needsScaleUpdate = true; // Need to recalculate domains
            needsZoomReset = true; // Axis range changes require resetting the base zoom state
        }

        // --- NEW: Check if maxTrackX changed ---
        if (oldXAxis.maxTrackX !== this.#config.xAxis.maxTrackX) {
            needsScaleUpdate = true; // Need to recalculate domains if following
        }
        // --- End NEW ---

        // Check if axis labels changed
        if (oldXAxis.label !== this.#config.xAxis.label || oldYAxis.label !== this.#config.yAxis.label) {
             updateAxisLabelsText(this.#svgElements.mainGroup, this.#config);
        }

        // Check if grid visibility changed
        if (oldXAxis.showGridLines !== this.#config.xAxis.showGridLines ||
            oldYAxis.showGridLines !== this.#config.yAxis.showGridLines) {
             // Just update grid lines, doesn't require full redraw unless scales also change
             updateGridLines(this.#d3, this.#svgElements, this.#scales, this.#config, this.#width, this.#height);
        }


        if (JSON.stringify(oldLegend) !== JSON.stringify(this.#config.legend)) {
            this.#updateChartLegend(); // Update legend appearance/position
        }

        if (JSON.stringify(oldInteractions) !== JSON.stringify(this.#config.interactions)) {
            needsInteractionUpdate = true;
        }

        if (oldConfig.maxDataPointsPerSeries !== this.#config.maxDataPointsPerSeries) {
            for (const seriesId in this.#dataStore) {
                pruneData(seriesId, this.#dataStore, this.#config);
            }
            needsScaleUpdate = true; // Data changed, scales might need update if following
        }

        // --- Apply Updates ---

        if (needsScaleUpdate) {
            // Recalculate domains based on new config/data (if following)
            // or keep frozen domains (if not following)
            this.#updateScalesAndAxes(); // This handles follow state internally
            needsFullRedraw = true; // Scales changed, redraw everything
        }

        if (needsZoomReset) {
             // If axis ranges changed, reset the zoom state to identity, using the
             // domains determined by #updateScalesAndAxes above.
             this.#syncScalesAndZoomState(
                 this.#scales.xScale.domain(),
                 this.#scales.yScale.domain(),
                 this.#d3.zoomIdentity
             );
             needsFullRedraw = true; // Ensure redraw happens after reset
        }


        if (needsInteractionUpdate && this.#targetElement) {
            // Re-setup interactions based on new config
            this.#setupInteractions();
        }

        if (needsFullRedraw) {
            // Perform a full redraw if scales or zoom state changed significantly
            this.redraw();
        } else {
             // If only minor things like grid lines or legend changed,
             // specific updates might have already happened.
             // We might still need to redraw lines if data pruning occurred without scale changes.
             if (oldConfig.maxDataPointsPerSeries !== this.#config.maxDataPointsPerSeries) {
                 this.#updateChartLines();
             }
        }
    }


    redraw() {
        if (this.#isDestroyed || !this.#targetElement) return;
        // #updateScalesAndAxes handles scale domains based on follow state / frozen state
        this.#updateScalesAndAxes();
        // Redraw components based on the final state of #scales
        this.#updateChartLines();
        this.#updateChartLegend(); // Legend might depend on series visibility/color from config
        // Grid/Axes are updated within #updateScalesAndAxes
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
        clearTimeout(this._zoomEndTimer); // Clear zoom end timer

        // Clear new scales
        this.#initialXScale = null;
        this.#initialYScale = null;
        this.#referenceXScale = null;
        this.#referenceYScale = null;

        console.log("StreamingChart destroyed.");
    }
}

module.exports = { StreamingChart }; // Export the class