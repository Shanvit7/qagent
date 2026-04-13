'use server';

const db = { user: { create: (_d: unknown) => ({}), delete: (_d: unknown) => ({}) } };

export async function createUser(name: string) {
  if (!name || name.length < 2) {
    throw new Error('Name must be at least 2 characters');
  }
  return db.user.create({ data: { name } });
}

export async function deleteUser(id: string) {
  return db.user.delete({ where: { id } });
}
