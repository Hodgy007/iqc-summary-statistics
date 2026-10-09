// Run every suite in UK time (the lab's time zone) so date handling is tested
// across BST, where UTC and local calendar days differ for early-morning results.
module.exports = () => {
  process.env.TZ = 'Europe/London';
};
