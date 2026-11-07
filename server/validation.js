const MAX_PUZZLE_ID_LENGTH = 12;
const MAX_EXCLUDE_IDS = 500;
const MAX_EXCLUDE_LENGTH = MAX_EXCLUDE_IDS * (MAX_PUZZLE_ID_LENGTH + 1) - 1;

const isValidPuzzleId = (id) =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= MAX_PUZZLE_ID_LENGTH &&
  id[0] !== "0" &&
  !/[^0-9]/.test(id);

const parseExcludedIds = (value) => {
  if (value === undefined) return [];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EXCLUDE_LENGTH
  ) {
    return null;
  }

  const ids = value.split(",");
  if (ids.length > MAX_EXCLUDE_IDS || !ids.every(isValidPuzzleId)) return null;
  return ids;
};

module.exports = { isValidPuzzleId, parseExcludedIds };
