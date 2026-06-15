import { randomUUID } from "node:crypto";
import { NotFoundError, assertListName } from "@preztiaos/domain";
import type { BorrowerListStore } from "./ports";

// Casos de uso de LISTAS PERSONALIZADAS (segmentación). CRUD de listas + alta/baja de miembros.

export class CreateBorrowerListHandler {
  constructor(private readonly lists: BorrowerListStore) {}

  async execute(input: { tenantId: string; name: string }): Promise<{ id: string }> {
    assertListName(input.name);
    const id = randomUUID();
    await this.lists.createList({ id, tenantId: input.tenantId, name: input.name.trim() });
    return { id };
  }
}

export class DeleteBorrowerListHandler {
  constructor(private readonly lists: BorrowerListStore) {}

  async execute(input: { tenantId: string; listId: string }): Promise<void> {
    const deleted = await this.lists.deleteList(input);
    if (!deleted) throw new NotFoundError("La lista no existe");
  }
}

export class AddListMembersHandler {
  constructor(private readonly lists: BorrowerListStore) {}

  async execute(input: {
    tenantId: string;
    listId: string;
    borrowerIds: readonly string[];
  }): Promise<{ added: number }> {
    const list = await this.lists.findList({ tenantId: input.tenantId, listId: input.listId });
    if (!list) throw new NotFoundError("La lista no existe");
    const added = await this.lists.addMembers(input);
    return { added };
  }
}

export class RemoveListMemberHandler {
  constructor(private readonly lists: BorrowerListStore) {}

  async execute(input: {
    tenantId: string;
    listId: string;
    borrowerId: string;
  }): Promise<void> {
    const removed = await this.lists.removeMember(input);
    if (!removed) throw new NotFoundError("El cliente no está en la lista");
  }
}
