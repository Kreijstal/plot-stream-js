/**
 * Default configuration and merging utilities for StreamingChart.
 */

const defaultConfig = {
  xAxis: {
    range: { min: null, max: null },
    label: "",
    showGridLines: true
  },
  yAxis: {
    range: { min: null, max: null },
    label: "",
    showGridLines: true
  },
  series: {},
  interactions: {
    zoom: true,
    pan: true,
    tooltip: false // Tooltip not implemented
  },
  legend: {
    visible: true,
    position: "top-right"
  },
  renderingHint: "quality",
  maxDataPointsPerSeries: 1000
};

function isObject(item) {
  return item && typeof item === "object" && !Array.isArray(item);
}

function deepMerge(target, source) {
  const output = { ...target };
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  return output;
}

module.exports = {
  defaultConfig,
  deepMerge,
  isObject // Exporting isObject in case it's needed elsewhere, though it's internal to deepMerge here
};