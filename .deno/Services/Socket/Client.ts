import { v4 as uuid } from "uuid";
import { isWebSocketCloseEvent, WebSocket } from "ws";

/**
 * Processes an incoming socket event and returns a result.
 *
 * @param data - Data object provided with the request.
 *
 * @returns a response value or undefined.
 */
type EventHandler = (data: any) => any;

interface EventHandlers {
  [event: string]: EventHandler;
}

export class WebSocketClient {
  /**
   * Socket client unique identifier.
   */
  public uuid: string;

  /**
   * WebSocket instance.
   */
  public socket: WebSocket;

  /**
   * Registered event handlers.
   */
  public handlers: EventHandlers = {};

  /**
   * Socket message queue.
   */
  private queue: {
    processing: boolean;
    messages: string[];
  } = {
    processing: false,
    messages: []
  };

  /**
   * Create a new WebSocketClient instance.
   *
   * @param socket - Instantiated WebSocket.
   */
  constructor(socket: WebSocket) {
    this.uuid = uuid.generate();
    this.socket = socket;
    this.listen();
  }

  /**
   * Listen for incoming events.
   *
   * @param event - Event trigger.
   * @param handler - Event handler.
   */
  public on(event: "closed" | string, handler: EventHandler): void {
    if (this.handlers[event]) {
      throw new Error(`Event handler for '${event}' has already been registered for this socket.`);
    }
    this.handlers[event] = handler;
  }

  /**
   * Publish a event to the socket.
   *
   * @param event - Event trigger.
   * @param data - Event data.
   */
  public async publish(event: string, data: any): Promise<void> {
    this.queue.messages.push(JSON.stringify({ event, data }));
    this.processQueue();
  }

  /**
   * Process messages in the queue.
   */
  private async processQueue() {
    if (this.queue.processing) {
      return false; // already processing another message ...
    }
    this.queue.processing = true;
    const msg = this.queue.messages.shift();
    if (msg) {
      await this.socket.send(msg);
      this.queue.processing = false;
      this.processQueue();
    } else {
      this.queue.processing = false;
    }
  }

  /**
   * Listen for socket events and emit them.
   */
  private async listen(): Promise<void> {
    console.log(`socket connected | uuid: ${this.uuid}`);

    const it = this.socket.receive();
    while (true) {
      try {
        const { done, value } = await it.next();
        if (done) {
          break;
        }
        if (typeof value === "string") {
          const { uuid, event, data } = JSON.parse(value);
          this.emit(uuid, event, data);
        } else if (isWebSocketCloseEvent(value)) {
          const handler = this.handlers.closed;
          if (handler) {
            handler({});
          }
        }
      } catch (err) {
        await this.socket.close(1000).catch(console.error);
      }
    }
  }

  /**
   * Emit data to all listeners of the given event.
   *
   * @param uuid - Unique message identifier.
   * @param event - Event being sent.
   * @param data - Data being sent. Default: {}
   */
  private emit(uuid: string, event: string, data: any = {}): void {
    const handler = this.handlers[event];
    if (handler) {
      try {
        this.publish(uuid, handler(data));
      } catch (err) {
        console.log(err);
        this.publish(uuid, { error: { code: "HANDLER_FAILED", message: err.message, stack: err.stack } });
      }
    } else {
      this.publish(uuid, { error: { code: "NO_HANDLER", message: `${event} has no valid handler registered.` } });
    }
  }
}
