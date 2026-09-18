/** Async route handler'lardaki hataları Express error middleware'ine aktarır. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
