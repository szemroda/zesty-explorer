import { useEffect, useState, type RefObject } from 'react';

// One observer serves every element, since tables register hundreds of them.
const onChange = new WeakMap<Element, (near: boolean) => void>();
let observer: IntersectionObserver | undefined;

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onChange.get(entry.target)?.(entry.isIntersecting);
    },
    // Start a little before a row scrolls in, so its data is usually there when it arrives.
    { rootMargin: '200px 0px' },
  );
  return observer;
}

/**
 * Whether the element is in or near the viewport right now. Without IntersectionObserver every
 * element counts as near.
 */
export function useNearViewport(element: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const target = element.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const shared = sharedObserver();
    onChange.set(target, setNear);
    shared.observe(target);
    return () => {
      shared.unobserve(target);
      onChange.delete(target);
    };
  }, [element]);
  return near;
}
