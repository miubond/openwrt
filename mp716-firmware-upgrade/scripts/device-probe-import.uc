'use strict';
import { physical_ports } from '/usr/share/mp716/physical-ports.uc';
import { route_admin } from '/usr/share/mp716/admin.uc';
print(sprintf('imports_ok ports=%d route=%d\n', type(physical_ports), type(route_admin)));