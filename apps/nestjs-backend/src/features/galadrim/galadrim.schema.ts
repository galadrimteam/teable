import { IdPrefix } from '@teable/core';
import { z } from 'zod';

export const galadrimUserRoSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1),
});

export type IGaladrimUserRo = z.infer<typeof galadrimUserRoSchema>;

export const galadrimTokenRoSchema = galadrimUserRoSchema.extend({
  baseId: z.string().startsWith(IdPrefix.Base).optional(),
});

export type IGaladrimTokenRo = z.infer<typeof galadrimTokenRoSchema>;

export const galadrimEnsureUsersRoSchema = z.object({
  users: z.array(galadrimUserRoSchema).min(1).max(1000),
});

export type IGaladrimEnsureUsersRo = z.infer<typeof galadrimEnsureUsersRoSchema>;

export const galadrimSpaceRoSchema = z.object({
  name: z.string().trim().min(1),
});

export type IGaladrimSpaceRo = z.infer<typeof galadrimSpaceRoSchema>;
