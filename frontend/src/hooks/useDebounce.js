import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce any fast-changing value (e.g. search input).
 * @param {any} value - Value to debounce
 * @param {number} delay - Debounce delay in milliseconds (default 200ms)
 * @returns {any} debounced value
 */
export const useDebounce = (value, delay = 200) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
