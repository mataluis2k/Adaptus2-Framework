// Utility to scale numerical values
function scale(value, range = [0, 1], existingParams = null) {
    const [min, max] = range;

    let scaleParams;
    if (existingParams) {
        scaleParams = existingParams;
    } else {
        scaleParams = { min: Math.min(...value), max: Math.max(...value) };
    }

    const scaled = (value - scaleParams.min) / (scaleParams.max - scaleParams.min) * (max - min) + min;
    return { scaled, scaleParams };
}

// Utility to one-hot encode categorical values
function oneHotEncode(value, existingCategories = null) {
    let categories = existingCategories || [];
    if (!categories.includes(value)) {
        categories.push(value);
    }

    const encoded = categories.map((category) => (category === value ? 1 : 0));
    return { encoded, categories };
}

module.exports = { scale, oneHotEncode };
