import { ScheduledChannel, ScheduledFrequency } from '@prisma/client';
import { defineEventHandler, readBody } from 'h3';
import { z } from 'zod';
import { requirePermission } from '../../utils/crypto';
import { getPrisma } from '../../utils/prisma';

const schedSchema = z.object({
  name: z.string().min(1),
  frequency: z.nativeEnum(ScheduledFrequency).default(ScheduledFrequency.DAILY),
  dayOfWeek: z.number().int().min(0).max(6).default(0),
  sendTime: z.string().default('22:00'),
  channel: z.nativeEnum(ScheduledChannel).default(ScheduledChannel.IN_APP),
  recipientEmails: z.array(z.string()).default([]),
  activityFilter: z.string().default('all'),
  includeProfits: z.boolean().default(true),
  includeAlerts: z.boolean().default(true),
});

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'view_reports');
  const body = schedSchema.parse(await readBody(event));
  const prisma = getPrisma();

  const schedule = await prisma.scheduledReportConfig.create({
    data: {
      name: body.name.trim(),
      frequency: body.frequency,
      dayOfWeek: body.dayOfWeek,
      sendTime: body.sendTime,
      channel: body.channel,
      recipientEmailsJson: body.recipientEmails,
      activityFilter: body.activityFilter,
      includeProfits: body.includeProfits,
      includeAlerts: body.includeAlerts,
    },
  });

  return { schedule };
});
