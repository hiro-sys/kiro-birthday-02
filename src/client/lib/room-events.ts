export type RoomEventHandlers = {
  onConnected: () => void;
  onUpdated: () => void;
  onDisconnected: () => void;
};

export function subscribeToRoomEvents(roomId: string, handlers: RoomEventHandlers): () => void {
  const source = new EventSource(`/api/rooms/${encodeURIComponent(roomId)}/events`);

  source.addEventListener("connected", handlers.onConnected);
  source.addEventListener("room-updated", handlers.onUpdated);
  source.addEventListener("error", handlers.onDisconnected);

  return () => source.close();
}
