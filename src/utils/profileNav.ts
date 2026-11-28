/** Open any user's profile page from anywhere (feed, comments, messages, stories…). App.tsx listens. */
export const OPEN_PROFILE_EVENT = 'echat:open-profile';

export function openUserProfile(userId: string | undefined | null): void {
  if (!userId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(OPEN_PROFILE_EVENT, { detail: userId }));
}

/** Click handler for an avatar/name inside a clickable row: opens the profile and stops the row's own click. */
export function profileClick(userId: string | undefined | null) {
  return (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    openUserProfile(userId);
  };
}
