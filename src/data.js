/**
 * Data management for StreamingChart: data storage, series configurations, pruning.
 */
const { getColorForSeries } = require('./utils');

// Note: dataStore and seriesConfigs are typically instance members of the chart class.
// These functions operate on those members passed in as arguments.

/**
 * Initializes series configurations based on the initial chart config.
 * @param {object} chartConfig - The main chart configuration object.
 * @param {object} seriesConfigs - The seriesConfigs object to populate.
 */
function initSeriesConfigs(chartConfig, seriesConfigs) {
    if (chartConfig.series) {
        for (const seriesId in chartConfig.series) {
            seriesConfigs[seriesId] = {
                label: seriesId,
                color: null, // Assigned later dynamically if needed
                lineWidth: 1.5,
                type: 'line',
                markerSize: 3, // Currently unused for 'line' type
                ...chartConfig.series[seriesId] // User overrides
            };
        }
    }
}

/**
 * Gets a default configuration object for a new series.
 * @param {string} seriesId - The ID of the new series.
 * @param {function} colorScale - The D3 color scale instance.
 * @returns {object} Default series configuration.
 */
function getDefaultSeriesConfig(seriesId, colorScale) {
    return {
        label: seriesId,
        color: getColorForSeries(colorScale, seriesId), // Assign color dynamically
        lineWidth: 1.5,
        type: 'line',
        markerSize: 3
    };
}

/**
 * Prunes data for a specific series if it exceeds the configured maximum.
 * @param {string} seriesId - The ID of the series to prune.
 * @param {object} dataStore - The main data store object.
 * @param {object} chartConfig - The main chart configuration object.
 */
function pruneData(seriesId, dataStore, chartConfig) {
    const maxPoints = chartConfig.maxDataPointsPerSeries;
    if (maxPoints !== null && maxPoints > 0 && dataStore[seriesId]) {
        const currentLength = dataStore[seriesId].length;
        if (currentLength > maxPoints) {
            // Remove oldest points from the beginning
            dataStore[seriesId] = dataStore[seriesId].slice(currentLength - maxPoints);
        }
    }
}

/**
 * Ensures a series exists in dataStore and seriesConfigs, creating defaults if necessary.
 * Calls a callback if a new series config was created (e.g., to update the legend).
 * @param {string} seriesId - The ID of the series.
 * @param {object} dataStore - The main data store object.
 * @param {object} seriesConfigs - The series configuration object.
 * @param {function} colorScale - The D3 color scale instance.
 * @param {function} onNewSeriesConfig - Callback function executed if a new config is created.
 */
function ensureSeriesExists(seriesId, dataStore, seriesConfigs, colorScale, onNewSeriesConfig) {
    let newConfigCreated = false;
    if (!dataStore[seriesId]) {
        dataStore[seriesId] = [];
    }
    if (!seriesConfigs[seriesId]) {
        // Use defaults if not pre-configured
        seriesConfigs[seriesId] = getDefaultSeriesConfig(seriesId, colorScale);
        newConfigCreated = true;
    } else if (!seriesConfigs[seriesId].color) {
        // Assign color if it wasn't set initially (e.g. pre-configured without color)
        seriesConfigs[seriesId].color = getColorForSeries(colorScale, seriesId);
        newConfigCreated = true; // Color was added, might affect legend
    }

    if (newConfigCreated && typeof onNewSeriesConfig === 'function') {
        onNewSeriesConfig(seriesId); // Notify that the config changed/was created
    }
}

/**
 * Updates the configuration of an existing series.
 * Merges the provided partial configuration with the series' current settings.
 * @param {string} seriesId - The identifier of the series whose configuration needs updating.
 * @param {object} partialConfig - A partial `SeriesConfig` object containing the properties to update.
 * @param {object} seriesConfigs - The series configuration object.
 * @returns {boolean} - True if the series existed and was updated, false otherwise.
 */
function updateSeriesConfig(seriesId, partialConfig, seriesConfigs) {
    if (!seriesConfigs[seriesId]) {
        console.warn(`Attempted to update config for non-existent series: ${seriesId}`);
        return false;
    }
    // Merge partial config
    seriesConfigs[seriesId] = {
        ...seriesConfigs[seriesId],
        ...partialConfig
    };
    return true;
}

/**
 * Assigns initial colors to series defined in the config if they don't have one.
 * @param {object} seriesConfigs - The series configuration object.
 * @param {function} colorScale - The D3 color scale instance.
 */
function assignInitialColors(seriesConfigs, colorScale) {
    for (const seriesId in seriesConfigs) {
        if (!seriesConfigs[seriesId].color) {
            seriesConfigs[seriesId].color = getColorForSeries(colorScale, seriesId);
        }
    }
}

module.exports = {
    initSeriesConfigs,
    getDefaultSeriesConfig,
    pruneData,
    ensureSeriesExists,
    updateSeriesConfig,
    assignInitialColors // <-- Add new export
};