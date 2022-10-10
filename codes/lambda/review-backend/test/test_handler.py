'''
 How to test: pytest test/test_handler.py --log-cli-level=INFO
'''

import os
import json

import pytest
import logging

from botocore.exceptions import ParamValidationError

os.environ['AWS_PROFILE'] = 'cdk-v2'
from src import handler


class TestHandler():
    @classmethod
    def setup_class(cls):
        logging.info('---setup_class---')
    
    
    @classmethod
    def teardown_class(cls):
        logging.info('---teardown_class---')
    
    
    def setup_method(self, method):
        logging.info('---setup_method---')
    
    
    def teardown_method(self, method):
        logging.info('---teardown_method---')
        
        
    def test_001a(self):
        logging.info('---test_001a: validate_input happy case----')
        
        request = {
            'ProductId': 'ts-1111',
            'Review': 'This is good.'
        }
        
        success, request = handler.validate_input(request)
        assert(success)
    
    
    def test_001b(self):
        logging.info('---test_001b: validate_input wrong case----')
        
        request = {
            'ProductId': 'ts-1111',
        }
        
        success, request = handler.validate_input(request)
        assert(not success)
    
    
    def test_002a(self):
        logging.info('---test_002a: get_comprehend----')
        
        comp = handler.get_comprehend()
        assert(comp is not None)
    
    
    def test_003a(self):
        logging.info('---test_003a: get_table----')
        
        table = handler.get_table()
        assert(table is not None)
    
    
    def test_004a(self):
        logging.info('---test_004a: analyze_sentiment happy case----')
        
        review = 'This is good.'
        language = 'en'
        
        result = handler.analyze_sentiment(review, language)
        
        assert(result is not None)
        assert('Sentiment' in result)
        assert(result['Sentiment'] == 'POSITIVE')
    
    
    def test_004b(self):
        logging.info('---test_004b: analyze_sentiment except----')
        
        review = ''
        language = ''
        
        with pytest.raises(ParamValidationError):
            result = handler.analyze_sentiment(review, language)
    
    
    def test_005a(self):
        logging.info('---test_005a: insert_item----')
        
        request = {
            'ProductId': 'ts-1111',
            'Review': 'This is good.',
            'Language': 'en'
        }
        sentiment = {
            'Sentiment': 'POSITIVE',
            'SentimentScore': {
                'Mixed': 7.052395085338503e-05,
                'Negative': 0.00011563824955374002, 
                'Neutral': 0.001149426563642919, 
                'Positive': 0.9986644983291626
            }
        }
        
        result = handler.insert_item(request, sentiment)
        
        assert(result)
    
    
    def test_006a(self):
        logging.info('---test_006a: handle----')
        
        with open('test/event.json') as f:
            event = json.load(f)
            response = handler.handle(event, None)
            logging.info(f'response: {response}')
            
            assert(response is not None)
            assert(response['statusCode'] == 200)
            assert(response['body'] is not None)
            assert( json.loads(response['body'])['Status'] == 'success')
        
