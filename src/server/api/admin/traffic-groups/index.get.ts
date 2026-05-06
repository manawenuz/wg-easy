export default definePermissionEventHandler('admin', 'settings', async () => {
  const groups = await Database.trafficGroups.getAll();
  return groups;
});
