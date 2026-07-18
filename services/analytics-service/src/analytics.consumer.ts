import { bookingEventsTopic, paymentEventsTopic } from '@bus/contracts-events';
import { logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Kafka, logLevel, type Admin, type Consumer } from 'kafkajs';

import {
  AnalyticsService,
  isBookingDomainEvent,
  isPaymentAttemptedEvent,
  isSearchPerformedEvent,
} from './analytics.service';

const searchEventsTopic = 'search-events';
const analyticsTopics = [bookingEventsTopic, searchEventsTopic, paymentEventsTopic];

export interface ConsumerLagSnapshot {
  available: boolean;
  totalLag: number;
  topics: Array<{ topic: string; lag: number }>;
}

@Injectable()
export class AnalyticsConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly groupId = process.env.ANALYTICS_KAFKA_GROUP_ID ?? 'analytics-service-v3';
  private readonly kafka = new Kafka({
    clientId: 'analytics-service',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
    logLevel: logLevel.NOTHING,
  });
  private readonly consumer: Consumer = this.kafka.consumer({ groupId: this.groupId });
  private readonly admin: Admin = this.kafka.admin();

  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.admin.connect();
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: bookingEventsTopic, fromBeginning: true });
    await this.consumer.subscribe({ topic: searchEventsTopic, fromBeginning: true });
    await this.consumer.subscribe({ topic: paymentEventsTopic, fromBeginning: true });
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const parsed = parseAnalyticsMessage(message.value);
        const applied =
          parsed !== undefined && topic === bookingEventsTopic && isBookingDomainEvent(parsed)
            ? await this.analyticsService.applyBookingEvent(parsed)
            : parsed !== undefined && topic === searchEventsTopic && isSearchPerformedEvent(parsed)
              ? await this.analyticsService.applySearchEvent(parsed)
              : parsed !== undefined &&
                  topic === paymentEventsTopic &&
                  isPaymentAttemptedEvent(parsed)
                ? await this.analyticsService.applyPaymentEvent(parsed)
                : undefined;
        if (applied === undefined) {
          logEvent({
            service: 'analytics-service',
            level: 'error',
            event: 'analytics.kafka.invalid-event',
            message: 'An invalid booking analytics event was rejected.',
            fields: { topic },
          });
          return;
        }
        const event = parsed as {
          eventId: string;
          eventType: string;
          traceId: string;
          requestId?: string;
        };
        logEvent({
          service: 'analytics-service',
          event: applied ? 'analytics.projection.applied' : 'analytics.projection.duplicate',
          message: applied ? 'Analytics event applied.' : 'Duplicate analytics event skipped.',
          ...(event.requestId && { requestId: event.requestId }),
          fields: {
            topic,
            eventId: event.eventId,
            eventType: event.eventType,
            traceId: event.traceId,
          },
        });
      },
    });
  }

  async getLag(): Promise<ConsumerLagSnapshot> {
    try {
      const committed = await this.admin.fetchOffsets({
        groupId: this.groupId,
        topics: analyticsTopics,
      });
      const topicLags = await Promise.all(
        analyticsTopics.map(async (topic) => {
          const latest = await this.admin.fetchTopicOffsets(topic);
          const offsets = committed.find((entry) => entry.topic === topic)?.partitions ?? [];
          const lag = latest.reduce((total, partition) => {
            const committedOffset = offsets.find(
              (entry) => entry.partition === partition.partition,
            )?.offset;
            const start =
              committedOffset && committedOffset !== '-1' ? committedOffset : partition.low;
            return total + bigintToSafeNumber(BigInt(partition.high) - BigInt(start));
          }, 0);
          return { topic, lag };
        }),
      );
      return {
        available: true,
        totalLag: topicLags.reduce((total, topic) => total + topic.lag, 0),
        topics: topicLags,
      };
    } catch (error) {
      logEvent({
        service: 'analytics-service',
        level: 'error',
        event: 'analytics.kafka.lag-unavailable',
        message: 'Kafka consumer lag could not be inspected.',
        fields: { reason: error instanceof Error ? error.name : 'UnknownError' },
      });
      return { available: false, totalLag: 0, topics: [] };
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.stop().catch(() => undefined);
    await this.consumer.disconnect().catch(() => undefined);
    await this.admin.disconnect().catch(() => undefined);
  }
}

export function parseAnalyticsMessage(value: Buffer | null): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value.toString());
  } catch {
    return undefined;
  }
}

function bigintToSafeNumber(value: bigint): number {
  if (value <= 0n) return 0;
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}
