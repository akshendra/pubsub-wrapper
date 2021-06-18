/// <reference types="node" />
import { PubSub as PubSubCore, Topic } from '@google-cloud/pubsub';
import EventEmitter from 'events';
interface PubSubConfig {
    projectId: string;
    file: string;
    credentials: {
        client_email: string;
        private_key: string;
    };
    ack_deadline_seconds?: number;
}
declare const _default: {
    new (name: string, emitter: EventEmitter, config: PubSubConfig): {
        /**
         * @param {string} name - unique name to this service
         * @param {EventEmitter} emitter
         * @param {Object} config - configuration object of service
         */
        name: string;
        emitter: EventEmitter;
        config: PubSubConfig;
        client: PubSubCore;
        topics: {
            [_: string]: Topic;
        };
        log(message: string, data?: Record<string, unknown>): void;
        success(message: string, data?: Record<string, unknown>): void;
        error(err: Error, data?: Record<string, unknown>): void;
        /**
         * Initialize the config for connecting to google apis
         *
         * @return {Promise<this>}
         */
        init(): Promise<any>;
        /**
         * Create a topic, must be done before anything else
         *
         * @param string name - name of the topic ot use
         *
         * @return {Promise<boolean>}
         */
        createTopic(name: string): Promise<boolean>;
        /**
         * Delete a topic, won't delete the subscription though
         *
         * @param {string} name - topic to delete
         *
         * @return {Promise<boolean>} resolve(true)
         */
        deleteTopic(name: string): Promise<boolean>;
        /**
         * Create a subscription and assign callback on message
         *
         * @param {string} topicName
         * @param {string} subName
         * @param {Function} cb - will get <message> with the following props
         *  id, ackId, data <pusblished>, attributes, timestamp, ack(), skip()
         * @param {Object} _options - tuning params
         * @param {number} _options.ackDeadlineSeconds - number of seconds
         *   after which message will marked nack
         * @param {boolean} [_options.autoAck=false]
         * @param {string} [_options.encoding='utf-8']
         * @param {number} [_options.interval=1] - interval between taking next message
         * @param {number} [_options.maxInProgress=1] - number of message at once
         * @param {string} [_options.pushEndPoint]
         * @param {number} [_options.timeout] - http call
         *
         * @return {Promise<true>}
         */
        subscribe(topicName: string, subName: string, cb: (...args: any) => any, options?: {
            maxInProgress?: number;
            ackDeadlineSeconds?: number;
        }): Promise<boolean>;
        /**
         * Remove a subscription from a topic
         *
         * @param {string} topicName
         * @param {string} subName
         * @param {Function} cb
         *
         * @return {Promise<true>}
         */
        unsubscribe(topicName: string, subName: string, cb: (...args: any) => any): Promise<boolean>;
        /**
         * Publish a message on the given queue
         *
         * @param {string} topicName - topic should be created in this instance
         * @param {Object} content - the data to send in negotiated structure
         * @param {Object} meta - things like correlationId and replyTo
         * @param {string} meta.replyTo
         * @param {string} meta.correlationId
         * @param {boolean} [handle=true] - whether to handle the error here
         *
         * @return {Promise}
         */
        publish(topicName: string, content?: Record<string, unknown>, meta?: {
            replyTo?: string;
            correlationId?: string;
        }, handle?: boolean): Promise<void>;
        /**
         * Just send on the topic, don't worry whether it exists or not
         *
         * @param {string} topicName - name of topic
         * @param {Object} content - the data to send in negotiated structure
         * @param {Object} meta - things like correlationId and replyTo
         * @param {string} meta.replyTo
         * @param {string} meta.correlationId
         * @param {boolean} [handle=true] - whether to handle the error here
         *
         * @return {Promise}
         */
        send(topicName: string, content: Record<string, unknown>, meta: Record<string, unknown>, handler?: boolean): Promise<void>;
        /**
         * Just send without any formating
         *
         * @param {string} topicName
         * @param {Buffer} data - the data to be sent
         * @param {boolean} [handle=true] - whether to handle the error here
         *
         * @return {Promise}
         */
        sendWithoutCover(topicName: string, data: Buffer, handler?: boolean): Promise<void>;
    };
};
/**
 * @class PubSub
 */
export = _default;
