export type AutopilotSystemCommand = {
  type: 'autopilot.fire';
  taskId: string;
  gateId: string;
  dueAt: number;
};
