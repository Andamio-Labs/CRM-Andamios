import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TasksService } from '../src/modules/tasks/tasks.service.js';
import { createTeam, createTestApp, type TestApp } from './support/test-app.js';

/** E06-S01 tareas, E06-S02 recordatorios y notificaciones, X-07 dashboard. */
describe('Tareas y recordatorios', () => {
  let t: TestApp;
  let team: Awaited<ReturnType<typeof createTeam>>;
  let dealId: string;
  let contactId: string;
  const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

  beforeAll(async () => {
    t = await createTestApp();
    team = await createTeam(t, 'Tareas SAS');
    const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
    contactId = (await team.owner.api.post('/api/v1/contacts', { name: 'Cliente de tareas' }).expect(201)).body.id;
    dealId = (await team.owner.api.post('/api/v1/deals', { title: 'Negocio con tareas', pipelineId: pipeline.id, contactId }).expect(201)).body.id;
  });
  afterAll(() => t.close());

  describe('CRUD (E06-S01)', () => {
    it('crea una tarea vinculada a un negocio con responsable y vencimiento; se completa y reabre', async () => {
      const task = (await team.owner.api.post('/api/v1/tasks', { title: 'Llamar para cotizar', dealId, assigneeId: team.seller.userId, dueAt: inMinutes(60) }).expect(201)).body;
      expect(task).toMatchObject({ status: 'open', dealId, assigneeId: team.seller.userId, contactId });
      const done = (await team.seller.api.patch(`/api/v1/tasks/${task.id}`, { status: 'done' }).expect(200)).body;
      expect(done.completedAt).toBeTruthy();
      expect((await team.seller.api.patch(`/api/v1/tasks/${task.id}`, { status: 'open' }).expect(200)).body.completedAt).toBeNull();
    });

    it('exige negocio o contacto, y un responsable del equipo', async () => {
      await team.owner.api.post('/api/v1/tasks', { title: 'Huérfana' }).expect(400);
      await team.owner.api.post('/api/v1/tasks', { title: 'X', contactId, assigneeId: 'ajeno' }).expect(400);
      await team.owner.api.post('/api/v1/tasks', { title: 'Con contacto', contactId }).expect(201);
    });

    it('filtros por estado (abiertas, vencidas, hechas) y por asignación (mías, sin asignar)', async () => {
      const { api } = team.admin;
      const overdue = (await api.post('/api/v1/tasks', { title: 'Vencida', dealId, assigneeId: team.admin.userId, dueAt: inMinutes(-30) }).expect(201)).body;
      const free = (await api.post('/api/v1/tasks', { title: 'Libre', dealId, dueAt: inMinutes(120) }).expect(201)).body;
      const ids = async (q: string) => (await api.get(`/api/v1/tasks?${q}`).expect(200)).body.map((x: { id: string }) => x.id);
      expect(await ids('status=overdue')).toContain(overdue.id);
      expect(await ids('status=overdue')).not.toContain(free.id);
      expect(await ids('assignment=mine')).toContain(overdue.id);
      expect(await ids('assignment=unassigned')).toContain(free.id);
      expect(await ids('assignment=unassigned')).not.toContain(overdue.id);
    });

    it('otra empresa no ve ni toca las tareas', async () => {
      const task = (await team.owner.api.post('/api/v1/tasks', { title: 'Privada', dealId }).expect(201)).body;
      const other = (await createTeam(t, 'Otra de tareas')).owner.api;
      await other.patch(`/api/v1/tasks/${task.id}`, { title: 'x' }).expect(404);
      expect((await other.get('/api/v1/tasks').expect(200)).body).toEqual([]);
      await other.post('/api/v1/tasks', { title: 'Con negocio ajeno', dealId }).expect(404);
    });
  });

  describe('Recordatorios y notificaciones (E06-S02)', () => {
    it('avisa in-app y por correo con la anticipación elegida, una sola vez', async () => {
      const task = (await team.owner.api.post('/api/v1/tasks', { title: 'Enviar propuesta', dealId, assigneeId: team.seller.userId, dueAt: inMinutes(10), remindBeforeMinutes: 15 }).expect(201)).body;
      const sweep = () => t.app.get(TasksService).sendDueReminders();
      await sweep();
      await sweep();

      const notes = (await team.seller.api.get('/api/v1/notifications').expect(200)).body;
      expect(notes.items.filter((n: { title: string }) => n.title.includes('Enviar propuesta'))).toHaveLength(1);
      expect(notes.unread).toBeGreaterThanOrEqual(1);
      expect(t.mailer.sent.filter((m) => m.to === team.seller.email && m.subject.includes('Enviar propuesta'))).toHaveLength(1);

      const n = notes.items.find((x: { title: string }) => x.title.includes('Enviar propuesta'));
      await team.seller.api.post(`/api/v1/notifications/${n.id}/read`).expect(204);
      expect((await team.seller.api.get('/api/v1/notifications').expect(200)).body.unread).toBe(notes.unread - 1);
      expect(task.id).toBeTruthy();
    });

    it('no avisa antes de tiempo; si cambia el vencimiento, vuelve a programarse', async () => {
      const task = (await team.owner.api.post('/api/v1/tasks', { title: 'Lejana', dealId, assigneeId: team.admin.userId, dueAt: inMinutes(600), remindBeforeMinutes: 30 }).expect(201)).body;
      await t.app.get(TasksService).sendDueReminders();
      expect(t.mailer.sent.some((m) => m.subject.includes('Lejana'))).toBe(false);

      await team.owner.api.patch(`/api/v1/tasks/${task.id}`, { dueAt: inMinutes(5) }).expect(200);
      await t.app.get(TasksService).sendDueReminders();
      expect(t.mailer.sent.filter((m) => m.subject.includes('Lejana'))).toHaveLength(1);
    });

    it('las notificaciones son de cada usuario', async () => {
      const notes = (await team.owner.api.get('/api/v1/notifications').expect(200)).body;
      expect(notes.items.some((n: { title: string }) => n.title.includes('Enviar propuesta'))).toBe(false);
    });
  });

  describe('Dashboard: lo que importa ahora (X-07)', () => {
    it('tareas de hoy, vencidas, mensajes sin leer, negocios sin próximo paso y canal conectado', async () => {
      const pipeline = (await team.owner.api.get('/api/v1/pipelines').expect(200)).body[0];
      const orphan = (await team.owner.api.post('/api/v1/deals', { title: 'Sin próximo paso', pipelineId: pipeline.id }).expect(201)).body;
      const today = (await team.admin.api.post('/api/v1/tasks', { title: 'Para hoy', dealId, assigneeId: team.admin.userId, dueAt: inMinutes(30) }).expect(201)).body;

      const board = (await team.admin.api.get('/api/v1/dashboard').expect(200)).body;
      expect(board.myTasksToday.map((x: { id: string }) => x.id)).toContain(today.id);
      expect(board.overdueTasks).toBeGreaterThanOrEqual(1);
      expect(board.unreadConversations).toBe(0);
      expect(board.dealsWithoutNextStep.count).toBeGreaterThanOrEqual(1);
      expect(board.dealsWithoutNextStep.items.map((d: { id: string }) => d.id)).toContain(orphan.id);
      expect(board.dealsWithoutNextStep.items.map((d: { id: string }) => d.id)).not.toContain(dealId);
      expect(board.channelConnected).toBe(false);
    });
  });
});
