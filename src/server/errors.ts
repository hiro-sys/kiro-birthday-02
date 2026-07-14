export class RoomServiceError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "RoomServiceError";
    this.statusCode = statusCode;
  }
}

export class DataStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataStoreError";
  }
}
