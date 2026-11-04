"""Software conformance fixtures; no model-capability or FLOP certification."""
import copy
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from wil_rbs import ContractError
from wil_rbs_catalog import catalog
from wil_rbs_instrument import TrainingStepMeter,verify_receipt,profile_torch_forward
from wil_rbs_ingest import import_langdepth106
from test_ingest_frontier import source_fixture
from test_wil_rbs import manifest

class CrossStudyCatalogTests(unittest.TestCase):
    def test_source_study_not_qualified(self):
        out=catalog(import_langdepth106(*source_fixture()))
        self.assertEqual(out['record_count'],2)
        self.assertEqual(out['comparability_group_count'],0)
        self.assertEqual(out['missing_source_contracts_prevent_ranking'],2)
        self.assertTrue(all(x['descriptive_pareto'] is None for x in out['models']))

    def test_historical_unqualified_and_mode_unspecified(self):
        m=json.loads((ROOT/'examples'/'historical_aggregates.json').read_text())
        out=catalog(m)
        self.assertEqual(out['record_count'],4)
        self.assertEqual(out['comparability_group_count'],0)
        self.assertTrue(all(x['source_protocol_mode'] is None for x in out['models']))
        self.assertTrue(all(x['descriptive_pareto'] is None for x in out['models']))

    def test_same_contract_pareto_descriptive(self):
        m=manifest()
        for e in m['records'][2:]:e['metric']['protocol_mode']='reset_windows'
        m['records'][0]['resources']['wall_seconds']=2.0
        m['records'][1]['resources']['wall_seconds']=1.5
        out=catalog(m)
        self.assertEqual(out['comparability_group_count'],1)
        self.assertTrue(all(r['descriptive_pareto'] for r in out['models']))
        self.assertFalse(out['science_qualified'])

    def test_different_evaluator_hash_rejects_rank(self):
        m=manifest()
        for e in m['records'][2:]:e['metric']['protocol_mode']='reset_windows'
        m['records'][3]['metric']['evaluator_sha256']='e'*64
        out=catalog(m)
        self.assertEqual(out['comparability_group_count'],0)
        self.assertTrue(all(r['descriptive_pareto'] is None for r in out['models']))

    def test_hardware_mismatch_prevents_wall_time_rank(self):
        m=manifest()
        for e in m['records'][2:]:e['metric']['protocol_mode']='reset_windows'
        m['records'][1]['runtime']['hardware_id']='different CPU'
        out=catalog(m)
        self.assertEqual(out['comparability_group_count'],0)
        self.assertTrue(all(r['mean_cost'] is not None for r in out['models']))

    def test_self_declared_flops_not_comparable(self):
        m=manifest()
        for e in m['records'][2:]:e['metric']['protocol_mode']='reset_windows'
        out=catalog(m,cost='training_flops')
        self.assertEqual(out['comparability_group_count'],0)
        self.assertTrue(all(not r['training_flops_authenticated'] for r in out['models']))

    def test_same_seed_same_arm_rejected(self):
        m=manifest()
        m['records'][1]['arm_id']='A'
        for e in m['records'][2:]:e['metric']['protocol_mode']='reset_windows'
        with self.assertRaises(ContractError):catalog(m)

class StepMeterTests(unittest.TestCase):
    def meter(self,**kw):
        n=[0]
        def clock():
            n[0]+=10_000_000
            return n[0]
        return TrainingStepMeter(run_id='fixture',hardware_id='cpu-test',
                                 precision='fp32',clock=clock,**kw)

    def test_valid_timing_never_certifies_flops(self):
        meter=self.meter()
        with meter.step(1):
            for stage in ('data','forward','backward','optimizer'):
                with meter.stage(stage):pass
        receipt=meter.receipt()
        self.assertEqual(receipt['completed_updates'],1)
        self.assertTrue(receipt['stage_coverage_complete'])
        self.assertIsNone(receipt['training_flops'])
        self.assertFalse(receipt['full_training_flops_certified'])
        self.assertEqual(verify_receipt(receipt)['status'],'RECEIPT_INTEGRITY_CHECKED')
        altered=copy.deepcopy(receipt)
        altered['events'][0]['total_wall_ns']+=1
        with self.assertRaises(ContractError):verify_receipt(altered)

    def test_failed_step_retained(self):
        meter=self.meter()
        with self.assertRaises(RuntimeError):
            with meter.step(1):
                with meter.stage('forward'):
                    raise RuntimeError('synthetic fixture failure')
        x=meter.receipt()
        self.assertEqual(x['failed_updates'],1)
        self.assertEqual(x['events'][0]['error_type'],'RuntimeError')
        self.assertFalse(x['stage_coverage_complete'])

    def test_nested_stage_and_duplicate_step_rejected(self):
        meter=self.meter()
        with meter.step(1):
            with meter.stage('forward'):
                with self.assertRaises(ContractError):
                    with meter.stage('optimizer'):pass
        with self.assertRaises(ContractError):
            with meter.step(1):pass

    def test_accelerator_requires_sync(self):
        with self.assertRaises(ContractError):self.meter(device_type='cuda')

    def test_optional_torch_profiler_remains_partial(self):
        try:import torch
        except ImportError:self.skipTest('optional torch missing')
        x=torch.ones((8,8))
        out=profile_torch_forward(lambda:x@x,run_id='smoke')
        self.assertGreater(out['observed_operator_flops'],0)
        self.assertIsNone(out['training_flops'])
        self.assertFalse(out['complete_operator_coverage_verified'])
        self.assertFalse(out['scientific_superiority_authorized'])

if __name__=='__main__':unittest.main()
