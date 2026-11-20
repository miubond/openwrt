// Pure parser/calibration regressions: no device commands or configuration writes.
import { parse_switch_link, mapping_labels, physical_ports } from '../physical-ports.uc';
let passed=[];
function assert(ok,name){if(!ok)die(name);push(passed,name);}
function cmd(text,code){return {output:text,code:code ?? 0};}
let down=parse_switch_link(3,cmd('port:3 link:down\n'));
assert(down.linkKnown && down.linkUp==false,'known_down');
let up=parse_switch_link(3,cmd('port:3 link:up speed:100baseT full-duplex \n'));
assert(up.linkKnown && up.linkUp && up.speedMbps==100,'known_up_speed');
for(let bad in [cmd('',1),cmd('port:3 link:down',255),cmd('garbage'),cmd('port:2 link:down'),cmd('port:3 link:down\nport:3 link:up'),cmd('port:3 link:up speed:999baseT full-duplex'),cmd('port:3 link:up'),null]) {
	let row=parse_switch_link(3,bad);assert(row.linkUp==null && !row.linkKnown,'query_failure_or_unknown_never_down_'+length(passed));
}
let mac='00:1c:a3:36:43:55', board='yunxm,mp716';
let map={schema:'mp716-port-map/v1',board:board,device_mac:mac,switch:'switch0',mappings:[{switch_port:3,label:'LAN4',verified:true,evidence:['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']}]};
assert(mapping_labels(sprintf('%J',map),board,mac)[3]=='LAN4','same_device_partial_map');
assert(!length(keys(mapping_labels(sprintf('%J',map),board,'00:1c:a3:36:43:56'))),'other_device_rejected');
assert(!length(keys(mapping_labels(sprintf('%J',map),'other-board',mac))),'other_board_rejected');
for(let row in [{...map.mappings[0],verified:false},{...map.mappings[0],evidence:[]},{...map.mappings[0],switch_port:6},{...map.mappings[0],label:'LAN5'}]) {
	assert(!length(keys(mapping_labels(sprintf('%J',{...map,mappings:[row]}),board,mac))),'invalid_calibration_rejected_'+length(passed));
}
assert(!length(keys(mapping_labels(sprintf('%J',{...map,mappings:[map.mappings[0],{...map.mappings[0],switch_port:2}]}),board,mac))),'duplicate_labels_rejected');
assert(!length(keys(mapping_labels(sprintf('%J',{...map,mappings:[{...map.mappings[0],evidence:[map.mappings[0].evidence[0],map.mappings[0].evidence[0]]}]}),board,mac))),'duplicate_evidence_is_not_two_samples');
let calls=0, ports=physical_ports((command)=>{calls++;return cmd('unavailable',1);},{'3':'LAN4'});
assert(calls==5 && length(ports)==5 && ports[3].label=='LAN4' && ports[3].mappingVerified,'verified_label_independent_of_live_link');
assert(ports[4].role=='unknown' && ports[4].label=='P4' && !ports[4].mappingVerified,'p4_not_guessed_wan');
assert(ports[3].linkUp==null && !ports[3].linkKnown,'mapped_port_query_failure_unknown');
printf('%J\n',{passed:passed,pure_parser_only:true,device_commands_executed:0});
