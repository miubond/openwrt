'use strict';
'require view';
'require fs';

return view.extend({
	load: function() {
		return Promise.all([
			fs.read('/etc/mp716-upgrade/platform').catch(function() { return 'unconfirmed'; }),
			fs.read('/etc/mp716-upgrade/flash-gate').catch(function() { return 'closed'; })
		]);
	},

	render: function(data) {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('MP716 firmware upgrade TEST')),
			E('p', {}, _('Installing official sysupgrade onto the vendor firmware does not enable an upgrade.')),
			E('p', {}, _('Platform: ') + String(data[0]).trim()),
			E('p', {}, _('Recovery gate: ') + String(data[1]).trim()),
			E('p', {}, _('This page does not call sysupgrade or mtd.'))
		]);
	}
});
