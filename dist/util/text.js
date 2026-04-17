export function stripMarkdown(input) {
    return input
        .replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => code.trim())
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^\s*[-*]\s+/gm, "- ")
        .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
export function chunkText(text, maxLength = 3500) {
    if (text.length <= maxLength) {
        return [text];
    }
    const chunks = [];
    let rest = text;
    while (rest.length > maxLength) {
        const candidate = rest.slice(0, maxLength);
        const splitAt = Math.max(candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf("。"), candidate.lastIndexOf(". "), candidate.lastIndexOf(" "));
        const boundary = splitAt > maxLength * 0.5 ? splitAt : maxLength;
        chunks.push(rest.slice(0, boundary).trim());
        rest = rest.slice(boundary).trim();
    }
    if (rest) {
        chunks.push(rest);
    }
    return chunks;
}
export function parseBoolean(value, fallback) {
    if (value == null || value === "") {
        return fallback;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}
export function parseList(value) {
    if (!value) {
        return [];
    }
    return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}
