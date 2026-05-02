import { firstValueFrom, take, toArray } from 'rxjs';
import { KafkaStreamsService, KafkaStreamMessage } from './kafka-streams.service';

describe('KafkaStreamsService', () => {
  let service: KafkaStreamsService;

  beforeEach(() => {
    service = new KafkaStreamsService();
  });

  function msg(topic: string, value: any): KafkaStreamMessage<any> {
    return { topic, partition: 0, offset: '1', key: null, value, timestamp: '0' };
  }

  it('stream() returns an Observable that receives subsequent dispatch() values', async () => {
    const observable = service.stream<{ x: number }>('topic-A');

    const received = firstValueFrom(observable.pipe(take(2), toArray()));
    service.dispatch(msg('topic-A', { x: 1 }));
    service.dispatch(msg('topic-A', { x: 2 }));

    await expect(received).resolves.toEqual([
      expect.objectContaining({ value: { x: 1 } }),
      expect.objectContaining({ value: { x: 2 } }),
    ]);
  });

  it('different topics are isolated subjects', async () => {
    const a = service.stream('topic-A');
    const b = service.stream('topic-B');

    const aValues: any[] = [];
    const bValues: any[] = [];
    a.subscribe((m) => aValues.push(m.value));
    b.subscribe((m) => bValues.push(m.value));

    service.dispatch(msg('topic-A', 'a1'));
    service.dispatch(msg('topic-B', 'b1'));
    service.dispatch(msg('topic-A', 'a2'));

    expect(aValues).toEqual(['a1', 'a2']);
    expect(bValues).toEqual(['b1']);
  });

  it('lazy creation: stream() before any dispatch creates the subject', () => {
    service.stream('lazy-topic');
    expect((service as any).subjects.has('lazy-topic')).toBe(true);
  });

  it('subscribers added AFTER dispatch do NOT receive earlier messages (Subject semantics)', () => {
    service.dispatch(msg('topic-X', 'first'));

    const received: any[] = [];
    service.stream('topic-X').subscribe((m) => received.push(m.value));

    expect(received).toEqual([]);

    service.dispatch(msg('topic-X', 'second'));
    expect(received).toEqual(['second']);
  });

  it('multiple subscribers on the same topic all receive each event', () => {
    const sub1: any[] = [];
    const sub2: any[] = [];
    service.stream('topic-multi').subscribe((m) => sub1.push(m.value));
    service.stream('topic-multi').subscribe((m) => sub2.push(m.value));

    service.dispatch(msg('topic-multi', 'shared'));

    expect(sub1).toEqual(['shared']);
    expect(sub2).toEqual(['shared']);
  });
});
